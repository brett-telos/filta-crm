"use server";

// Quote actions — create/update drafts, send, mark accepted/declined.
//
// Quotes live under an opportunity. The ID flow is:
//   /opportunities/[id]/quote               → create/edit the latest draft (or v1)
//   /api/quotes/[versionId]/pdf             → download
//   sendQuoteAction(versionId)              → email + advance opp stage
//
// Save semantics:
//   - On first save for an opportunity, version_number = 1, status = 'draft'.
//   - Subsequent saves update the same draft in place — we don't auto-bump
//     version on every keystroke. A new version is created explicitly via
//     createNewVersionAction (e.g. after a sent quote needs to be revised).
//   - Customer details (company name, address, contact) are SNAPSHOTTED at
//     save time, not just at creation. A rep editing a draft picks up the
//     latest account state until they hit save.
//
// Send semantics: same three-phase pattern as the FS cross-sell action
// (TX1: snapshot + queue email_sends row → network call → TX2: finalize
// status + activity + auto-followup task) so the failure modes are
// understood and Resend hiccups don't leave orphaned data.

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  activities,
  contacts,
  emailSends,
  messageTemplates,
  opportunities,
  quoteLineItems,
  quoteVersions,
  serviceAgreements,
  users,
  withSession,
} from "@/db";
import { requireSession } from "@/lib/session";
import { sendEmail } from "@/lib/resend";
import {
  renderTemplate,
  replyAddressFor,
  senderIdentityFor,
  wrapInBaseHtml,
} from "@/lib/email-templates";
import { renderQuotePdf } from "@/lib/pdf/QuoteDocument";
import { quotePdfDataFromRow } from "@/lib/pdf/quote-data";
import { renderServiceAgreementPdf } from "@/lib/pdf/ServiceAgreementDocument";
import { agreementPdfDataFromRow } from "@/lib/pdf/agreement-data";
import { createAutoFollowUpTask } from "../tasks/actions";

// ============================================================================
// SAVE / UPSERT
// ============================================================================

const LineInput = z.object({
  // Existing line ids are passed back; new lines pass null and get inserted.
  id: z.string().uuid().optional().nullable(),
  serviceType: z
    .enum(["ff", "fs", "fb", "fg", "fc", "fd"])
    .optional()
    .nullable(),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  frequency: z.enum([
    "per_visit",
    "monthly",
    "quarterly",
    "annual",
    "one_time",
  ]),
  displayOrder: z.number().int().nonnegative().default(0),
});

const SaveQuoteInput = z.object({
  opportunityId: z.string().uuid(),
  // Optional — when present we update that version; omitted = upsert latest
  // draft (or create v1).
  quoteVersionId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional().nullable(),
  validUntilIso: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  lines: z.array(LineInput).max(40),
});

export type SaveQuoteResult = {
  ok: boolean;
  error?: string;
  quoteVersionId?: string;
};

const FREQUENCY_TO_MONTHLY: Record<
  z.infer<typeof LineInput>["frequency"],
  number
> = {
  per_visit: 4, // ~weekly cadence; rough but matches FF reality
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  one_time: 0,
};

/** Recompute the totals snapshot from the line items array. */
function totalsFor(lines: z.infer<typeof LineInput>[]): {
  subtotalMonthly: number;
  subtotalQuarterly: number;
  subtotalOneTime: number;
  estimatedAnnual: number;
} {
  let subtotalMonthly = 0;
  let subtotalQuarterly = 0;
  let subtotalOneTime = 0;
  let estimatedAnnual = 0;
  for (const l of lines) {
    const lineTotal = l.quantity * l.unitPrice;
    if (l.frequency === "monthly") subtotalMonthly += lineTotal;
    else if (l.frequency === "quarterly") subtotalQuarterly += lineTotal;
    else if (l.frequency === "one_time") subtotalOneTime += lineTotal;
    estimatedAnnual += lineTotal * 12 * FREQUENCY_TO_MONTHLY[l.frequency];
    if (l.frequency === "annual") {
      // FREQUENCY_TO_MONTHLY for annual is 1/12 → ×12 lands at 1×lineTotal,
      // which is correct.
    }
    if (l.frequency === "one_time") {
      // One-time charges aren't recurring, so they don't add to the annual
      // run-rate. Subtract them back out — the headline 'estimated annual'
      // should be the recurring run-rate, with one-time charges visible
      // separately on the totals block.
      estimatedAnnual -= 0; // explicit no-op; the *=0 above already excluded it
    }
  }
  return {
    subtotalMonthly: round2(subtotalMonthly),
    subtotalQuarterly: round2(subtotalQuarterly),
    subtotalOneTime: round2(subtotalOneTime),
    estimatedAnnual: round2(estimatedAnnual),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function saveQuoteAction(
  input: z.infer<typeof SaveQuoteInput>,
): Promise<SaveQuoteResult> {
  const session = await requireSession();
  const parsed = SaveQuoteInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "Invalid input",
    };
  }
  const { opportunityId, quoteVersionId, notes, validUntilIso, lines } =
    parsed.data;

  return withSession(session, async (tx) => {
    // Look up the opportunity + parent account to grab the customer
    // snapshot and to enforce territory scoping.
    const [opp] = await tx
      .select({
        id: opportunities.id,
        accountId: opportunities.accountId,
        deletedAt: opportunities.deletedAt,
        accountTerritory: accounts.territory,
        accountStatus: accounts.accountStatus,
        companyName: accounts.companyName,
        addressLine1: accounts.addressLine1,
        addressLine2: accounts.addressLine2,
        city: accounts.city,
        state: accounts.state,
        zip: accounts.zip,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .where(eq(opportunities.id, opportunityId))
      .limit(1);

    if (!opp || opp.deletedAt) {
      return { ok: false, error: "Opportunity not found" };
    }
    if (
      session.territory !== "both" &&
      opp.accountTerritory !== session.territory &&
      opp.accountTerritory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    // Primary contact for the customer snapshot.
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.accountId, opp.accountId), isNull(contacts.deletedAt)),
      )
      .orderBy(desc(contacts.isPrimary), desc(contacts.updatedAt))
      .limit(1);

    const customerSnapshot = {
      customerCompanyName: opp.companyName,
      customerAddress: {
        line1: opp.addressLine1 ?? null,
        line2: opp.addressLine2 ?? null,
        city: opp.city ?? null,
        state: opp.state ?? null,
        zip: opp.zip ?? null,
      },
      customerContactName:
        contact?.fullName ??
        [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ??
        null,
      customerContactEmail: contact?.email ?? null,
    };

    const totals = totalsFor(lines);
    const validUntil = validUntilIso ?? null;

    // Resolve target version: explicit id, else latest draft, else create v1.
    let versionId = quoteVersionId;
    if (!versionId) {
      const [latestDraft] = await tx
        .select({
          id: quoteVersions.id,
          status: quoteVersions.status,
        })
        .from(quoteVersions)
        .where(
          and(
            eq(quoteVersions.opportunityId, opportunityId),
            isNull(quoteVersions.deletedAt),
          ),
        )
        .orderBy(desc(quoteVersions.versionNumber))
        .limit(1);
      if (latestDraft && latestDraft.status === "draft") {
        versionId = latestDraft.id;
      }
    }

    if (versionId) {
      // Update existing version. Only allow edits while in 'draft' — sent
      // quotes are immutable; the rep should create a new version instead.
      const [existing] = await tx
        .select({ id: quoteVersions.id, status: quoteVersions.status })
        .from(quoteVersions)
        .where(eq(quoteVersions.id, versionId))
        .limit(1);
      if (!existing) return { ok: false, error: "Quote version not found" };
      if (existing.status !== "draft") {
        return {
          ok: false,
          error: `Cannot edit a ${existing.status} quote — create a new version`,
        };
      }
      await tx
        .update(quoteVersions)
        .set({
          ...customerSnapshot,
          ...totals,
          validUntil,
          notes: notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(quoteVersions.id, versionId));

      // Replace line items wholesale — simplest correct behavior, and the
      // line-item table is small per quote (≤40 rows enforced above).
      await tx
        .delete(quoteLineItems)
        .where(eq(quoteLineItems.quoteVersionId, versionId));
    } else {
      // Insert v1 (or vN+1 if there are non-draft prior versions). Compute
      // the next version number app-side.
      const [latest] = await tx
        .select({ versionNumber: quoteVersions.versionNumber })
        .from(quoteVersions)
        .where(eq(quoteVersions.opportunityId, opportunityId))
        .orderBy(desc(quoteVersions.versionNumber))
        .limit(1);
      const nextVersion = (latest?.versionNumber ?? 0) + 1;

      const [row] = await tx
        .insert(quoteVersions)
        .values({
          opportunityId,
          versionNumber: nextVersion,
          status: "draft",
          ...customerSnapshot,
          ...totals,
          validUntil,
          notes: notes ?? null,
          createdByUserId: session.sub,
        })
        .returning({ id: quoteVersions.id });
      versionId = row.id;
    }

    // Insert the new line items.
    if (lines.length > 0) {
      await tx.insert(quoteLineItems).values(
        lines.map((l, idx) => ({
          quoteVersionId: versionId!,
          serviceType: l.serviceType ?? null,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          frequency: l.frequency,
          displayOrder: l.displayOrder ?? idx,
        })),
      );
    }

    revalidatePath(`/opportunities/${opportunityId}/quote`);
    revalidatePath(`/accounts/${opp.accountId}`);
    revalidatePath("/pipeline");

    return { ok: true, quoteVersionId: versionId };
  });
}

// ============================================================================
// SEND QUOTE (email + attach PDF + advance opp + create follow-up)
// ============================================================================

const SendQuoteInput = z.object({
  quoteVersionId: z.string().uuid(),
});

export type SendQuoteResult = {
  ok: boolean;
  error?: string;
  emailSendId?: string;
  followUpTaskId?: string;
  devStub?: boolean;
};

const FOLLOW_UP_DAYS = 5;

/**
 * Send a draft quote. Pipeline:
 *   TX1: validate, snapshot the quote + customer, render PDF buffer,
 *        insert email_sends row (status='queued') with a placeholder
 *        provider_message_id-less state.
 *   network: Resend with attachment.
 *   TX2: on success, mark quote.status='sent', stamp sent_at, link
 *        sent_email_send_id, advance opp stage to 'proposal' if earlier,
 *        write outbound activity, create 5-day follow-up task.
 */
export async function sendQuoteAction(
  input: z.infer<typeof SendQuoteInput>,
): Promise<SendQuoteResult> {
  const session = await requireSession();
  const parsed = SendQuoteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }
  const { quoteVersionId } = parsed.data;

  // ---- TX1: snapshot + queue ---------------------------------------------
  const prep = await withSession(session, async (tx) => {
    const [row] = await tx
      .select({
        // quote
        id: quoteVersions.id,
        opportunityId: quoteVersions.opportunityId,
        versionNumber: quoteVersions.versionNumber,
        status: quoteVersions.status,
        customerCompanyName: quoteVersions.customerCompanyName,
        customerAddress: quoteVersions.customerAddress,
        customerContactName: quoteVersions.customerContactName,
        customerContactEmail: quoteVersions.customerContactEmail,
        validUntil: quoteVersions.validUntil,
        notes: quoteVersions.notes,
        subtotalMonthly: quoteVersions.subtotalMonthly,
        subtotalQuarterly: quoteVersions.subtotalQuarterly,
        subtotalOneTime: quoteVersions.subtotalOneTime,
        estimatedAnnual: quoteVersions.estimatedAnnual,
        // opp + account context
        accountId: opportunities.accountId,
        accountTerritory: accounts.territory,
        oppStage: opportunities.stage,
        // sender
        senderFirstName: users.firstName,
        senderLastName: users.lastName,
        senderEmail: users.email,
      })
      .from(quoteVersions)
      .innerJoin(
        opportunities,
        eq(opportunities.id, quoteVersions.opportunityId),
      )
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
      .where(eq(quoteVersions.id, quoteVersionId))
      .limit(1);

    if (!row) return { kind: "error" as const, error: "Quote not found" };
    if (
      session.territory !== "both" &&
      row.accountTerritory !== session.territory &&
      row.accountTerritory !== "unassigned"
    ) {
      return { kind: "error" as const, error: "Access denied" };
    }
    if (row.status !== "draft") {
      return {
        kind: "error" as const,
        error: `Quote is already ${row.status}`,
      };
    }
    if (!row.customerContactEmail) {
      return {
        kind: "error" as const,
        error: "No contact email on file — add one before sending",
      };
    }

    // Pull line items for the PDF render.
    const lines = await tx
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteVersionId, quoteVersionId))
      .orderBy(asc(quoteLineItems.displayOrder));

    // Resolve template (proposal_sent purpose).
    const [tpl] = await tx
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.purpose, "proposal_sent"),
          eq(messageTemplates.active, true),
        ),
      )
      .orderBy(desc(messageTemplates.updatedAt))
      .limit(1);

    const sender = senderIdentityFor(row.accountTerritory);
    const senderFirstName = row.senderFirstName ?? sender.fromName;
    const senderFullName =
      [row.senderFirstName, row.senderLastName].filter(Boolean).join(" ") ||
      sender.fromName;

    const vars = {
      firstName: row.customerContactName?.split(" ")[0] || "there",
      companyName: row.customerCompanyName,
      senderFirstName,
      senderFullName,
      territoryLabel: sender.territoryLabel,
      quoteRef: `Q-${row.opportunityId.slice(0, 6)}-v${row.versionNumber}`,
      annualValue: formatCurrency(Number(row.estimatedAnnual)),
    };

    // Fall back to a hardcoded subject/body if the template seed hasn't
    // been run — keeps send-quote usable on a fresh checkout.
    const subjectTemplate =
      tpl?.subjectTemplate ??
      "Your Filta proposal — {{companyName}}";
    const htmlTemplate =
      tpl?.bodyHtmlTemplate ??
      `<p>Hi {{firstName}},</p>
<p>Attached is your Filta proposal for <strong>{{companyName}}</strong>. The estimated annual value is {{annualValue}} based on the services we discussed.</p>
<p>Reply to this email or call when you'd like to move forward — we'll send the full Service Agreement for signature and schedule the first visit within a week.</p>
<p>Thanks,<br/><strong>{{senderFirstName}}</strong><br/>Filta {{territoryLabel}}</p>`;
    const textTemplate =
      tpl?.bodyTextTemplate ??
      `Hi {{firstName}},

Attached is your Filta proposal for {{companyName}}. The estimated annual value is {{annualValue}} based on the services we discussed.

Reply or call when you're ready to move forward.

Thanks,
{{senderFirstName}}
Filta {{territoryLabel}}`;

    const renderedSubject = renderTemplate(subjectTemplate, vars);
    const renderedHtmlFragment = renderTemplate(htmlTemplate, vars);
    const renderedText = renderTemplate(textTemplate, vars);
    const renderedHtml = wrapInBaseHtml({
      territory: row.accountTerritory,
      contentHtml: renderedHtmlFragment,
      preheader: `Filta proposal for ${row.customerCompanyName} — annual value ${formatCurrency(Number(row.estimatedAnnual))}.`,
    });

    // Render the PDF *now* so we can pass it to Resend in a moment. We do
    // this inside TX1 to keep the snapshot atomic with the queued row;
    // failure here aborts the TX cleanly.
    const pdfBuffer = await renderQuotePdf(quotePdfDataFromRow(row, lines));

    // Snapshot the queued send — the PDF buffer doesn't go in the DB; it
    // gets re-rendered on download (idempotent since totals are frozen).
    const [send] = await tx
      .insert(emailSends)
      .values({
        accountId: row.accountId,
        contactId: null,
        opportunityId: row.opportunityId,
        templateId: tpl?.id ?? null,
        fromEmail: sender.fromEmail,
        fromName: sender.fromName,
        toEmail: row.customerContactEmail,
        subject: renderedSubject,
        bodyHtml: renderedHtml,
        bodyText: renderedText,
        status: "queued",
        sentByUserId: session.sub,
      })
      .returning({ id: emailSends.id });

    return {
      kind: "ready" as const,
      emailSendId: send.id,
      quoteVersionId: row.id,
      opportunityId: row.opportunityId,
      accountId: row.accountId,
      oppStage: row.oppStage,
      companyName: row.customerCompanyName,
      toEmail: row.customerContactEmail,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo: process.env.EMAIL_REPLY_TO || replyAddressFor(row.accountTerritory, send.id),
      pdfBuffer,
      pdfFilename: `Filta-Quote-${vars.quoteRef}.pdf`,
    };
  });

  if (prep.kind === "error") return { ok: false, error: prep.error };

  // ---- network ----------------------------------------------------------
  const sendResult = await sendEmail({
    from: prep.fromEmail,
    fromName: prep.fromName,
    to: prep.toEmail,
    subject: prep.subject,
    html: prep.html,
    text: prep.text,
    replyTo: prep.replyTo,
    tags: [{ name: "campaign", value: "quote_sent" }],
    attachments: [
      {
        filename: prep.pdfFilename,
        content: prep.pdfBuffer.toString("base64"),
      },
    ],
  });

  // ---- TX2: finalize ----------------------------------------------------
  const finalize = await withSession(session, async (tx) => {
    if (!sendResult.ok) {
      await tx
        .update(emailSends)
        .set({ status: "failed", providerError: sendResult.error })
        .where(eq(emailSends.id, prep.emailSendId));
      return { kind: "failed" as const, error: sendResult.error };
    }

    const now = new Date();
    await tx
      .update(emailSends)
      .set({
        status: "sent",
        providerMessageId: sendResult.providerMessageId,
        sentAt: now,
      })
      .where(eq(emailSends.id, prep.emailSendId));

    // Mark the quote as sent and link the email_sends row.
    await tx
      .update(quoteVersions)
      .set({
        status: "sent",
        sentAt: now,
        sentEmailSendId: prep.emailSendId,
        updatedAt: now,
      })
      .where(eq(quoteVersions.id, prep.quoteVersionId));

    // Advance the opp stage to 'proposal' if it's earlier in the funnel.
    if (
      prep.oppStage === "new_lead" ||
      prep.oppStage === "contacted" ||
      prep.oppStage === "qualified"
    ) {
      await tx
        .update(opportunities)
        .set({
          stage: "proposal",
          stageChangedAt: now,
          updatedAt: now,
        })
        .where(eq(opportunities.id, prep.opportunityId));
    }

    // Activity row for the timeline.
    await tx.insert(activities).values({
      accountId: prep.accountId,
      opportunityId: prep.opportunityId,
      type: "email",
      direction: "outbound",
      subject: `Sent quote: ${prep.subject}`,
      body: `Quote PDF emailed to ${prep.toEmail}.`,
      ownerUserId: session.sub,
    });

    // Auto follow-up task — same 5-day cadence as the cross-sell flow.
    const followUpTaskId = await createAutoFollowUpTask(tx, {
      accountId: prep.accountId,
      opportunityId: prep.opportunityId,
      assigneeUserId: session.sub,
      title: `Follow up on quote to ${prep.companyName}`,
      notes: `Auto-created after sending "${prep.subject}".`,
      daysOut: FOLLOW_UP_DAYS,
      autoSource: "quote_sent_v1",
    });

    return { kind: "sent" as const, followUpTaskId };
  });

  revalidatePath("/pipeline");
  revalidatePath("/today");
  revalidatePath(`/accounts/${prep.accountId}`);
  revalidatePath(`/opportunities/${prep.opportunityId}/quote`);

  if (finalize.kind === "failed") {
    return {
      ok: false,
      error: finalize.error ?? "Send failed",
      emailSendId: prep.emailSendId,
    };
  }

  return {
    ok: true,
    emailSendId: prep.emailSendId,
    followUpTaskId: finalize.followUpTaskId,
    devStub: sendResult.ok ? sendResult.devStub : undefined,
  };
}


// ============================================================================
// ACCEPT QUOTE — generates the Service Agreement, emails it, kicks off
// onboarding, flips the account to customer
// ============================================================================

const AcceptQuoteInput = z.object({
  quoteVersionId: z.string().uuid(),
});

export type AcceptQuoteResult = {
  ok: boolean;
  error?: string;
  serviceAgreementId?: string;
  emailSendId?: string;
  followUpTaskId?: string;
  devStub?: boolean;
};

const FIRST_VISIT_FOLLOW_UP_DAYS = 1;
// Initial term per the corporate Service Agreement template.
const INITIAL_TERM_YEARS = 3;

/**
 * Accept a sent quote. Pipeline:
 *
 *   TX1: validate (quote.status must be 'sent'), pull all the data we need
 *        (quote + account + lines + sender), insert a service_agreements
 *        row in 'draft', insert email_sends queued, render the agreement
 *        PDF buffer.
 *   network: Resend with PDF attached (uses 'service_agreement_v1' template
 *            if seeded; otherwise hardcoded fallback).
 *   TX2: on success, mark agreement 'sent', mark quote 'accepted', flip
 *        account_status -> 'customer' (if currently prospect), set
 *        sales_funnel_stage='closed_won', advance the parent opportunity
 *        to 'closed_won' with stamped actualCloseDate, write a 'Sent: ...'
 *        outbound activity, create a high-priority "Schedule first visit"
 *        task due tomorrow.
 *
 * Idempotency: if the quote is already 'accepted', returns the existing
 * agreement id without doing anything else. Re-clicking the button is a
 * safe no-op.
 */
export async function acceptQuoteAction(
  input: z.infer<typeof AcceptQuoteInput>,
): Promise<AcceptQuoteResult> {
  const session = await requireSession();
  const parsed = AcceptQuoteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }
  const { quoteVersionId } = parsed.data;

  // ---- TX1: validate, snapshot, queue ------------------------------------
  const prep = await withSession(session, async (tx) => {
    const [row] = await tx
      .select({
        id: quoteVersions.id,
        opportunityId: quoteVersions.opportunityId,
        versionNumber: quoteVersions.versionNumber,
        status: quoteVersions.status,
        customerCompanyName: quoteVersions.customerCompanyName,
        customerAddress: quoteVersions.customerAddress,
        customerContactName: quoteVersions.customerContactName,
        customerContactEmail: quoteVersions.customerContactEmail,
        accountId: opportunities.accountId,
        accountStatus: accounts.accountStatus,
        accountTerritory: accounts.territory,
        accountPhone: accounts.phone,
        oppStage: opportunities.stage,
        senderFirstName: users.firstName,
        senderLastName: users.lastName,
        senderEmail: users.email,
      })
      .from(quoteVersions)
      .innerJoin(
        opportunities,
        eq(opportunities.id, quoteVersions.opportunityId),
      )
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
      .where(eq(quoteVersions.id, quoteVersionId))
      .limit(1);

    if (!row) return { kind: "error" as const, error: "Quote not found" };
    if (
      session.territory !== "both" &&
      row.accountTerritory !== session.territory &&
      row.accountTerritory !== "unassigned"
    ) {
      return { kind: "error" as const, error: "Access denied" };
    }

    // Idempotency — already accepted is a no-op success.
    if (row.status === "accepted") {
      const [existing] = await tx
        .select({ id: serviceAgreements.id })
        .from(serviceAgreements)
        .where(
          and(
            eq(serviceAgreements.quoteVersionId, row.id),
            isNull(serviceAgreements.deletedAt),
          ),
        )
        .limit(1);
      return {
        kind: "already_accepted" as const,
        serviceAgreementId: existing?.id,
      };
    }

    if (row.status !== "sent") {
      return {
        kind: "error" as const,
        error: `Cannot accept a quote that is in '${row.status}' status — send it first`,
      };
    }
    if (!row.customerContactEmail) {
      return {
        kind: "error" as const,
        error: "No contact email on file — required to send agreement",
      };
    }

    const lines = await tx
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteVersionId, quoteVersionId))
      .orderBy(asc(quoteLineItems.displayOrder));

    // Term dates — 3-year initial term per corporate template.
    const termStart = new Date();
    const termEnd = new Date(termStart);
    termEnd.setUTCFullYear(termEnd.getUTCFullYear() + INITIAL_TERM_YEARS);

    // Insert the service_agreements row in 'draft' so the row exists when
    // we generate the PDF (the agreementRef in the PDF derives from row.id).
    const [agreementRow] = await tx
      .insert(serviceAgreements)
      .values({
        quoteVersionId: row.id,
        accountId: row.accountId,
        status: "draft",
        termStartDate: termStart.toISOString().slice(0, 10),
        termEndDate: termEnd.toISOString().slice(0, 10),
        sentToEmail: row.customerContactEmail,
        createdByUserId: session.sub,
      })
      .returning({
        id: serviceAgreements.id,
        createdAt: serviceAgreements.createdAt,
      });

    // Resolve template (proposal_sent purpose works for now; if a dedicated
    // service_agreement_v1 is seeded, future flow can switch).
    const [tpl] = await tx
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.key, "service_agreement_v1"),
          eq(messageTemplates.active, true),
        ),
      )
      .limit(1);

    const sender = senderIdentityFor(row.accountTerritory);
    const senderFirstName = row.senderFirstName ?? sender.fromName;
    const senderFullName =
      [row.senderFirstName, row.senderLastName].filter(Boolean).join(" ") ||
      sender.fromName;

    const vars = {
      firstName: row.customerContactName?.split(" ")[0] || "there",
      companyName: row.customerCompanyName,
      senderFirstName,
      senderFullName,
      territoryLabel: sender.territoryLabel,
      agreementRef: `SA-${agreementRow.id.slice(0, 6)}`,
    };

    const subjectTemplate =
      tpl?.subjectTemplate ??
      "Welcome to Filta — your service agreement is attached";
    const htmlTemplate =
      tpl?.bodyHtmlTemplate ??
      `<p>Hi {{firstName}},</p>
<p>Thanks for choosing Filta. Attached is the Service Agreement for <strong>{{companyName}}</strong>. Take a look and sign at your convenience — once we have it back, we'll schedule the first visit.</p>
<p>I'll be in touch in the next day or two to lock in a start date. If you have questions before then, just reply to this email or give me a call.</p>
<p>Thanks,<br/><strong>{{senderFirstName}}</strong><br/>Filta {{territoryLabel}}</p>`;
    const textTemplate =
      tpl?.bodyTextTemplate ??
      `Hi {{firstName}},

Thanks for choosing Filta. Attached is the Service Agreement for {{companyName}}. Sign at your convenience — once we have it back, we'll schedule the first visit.

I'll be in touch in the next day or two to lock in a start date.

Thanks,
{{senderFirstName}}
Filta {{territoryLabel}}`;

    const renderedSubject = renderTemplate(subjectTemplate, vars);
    const renderedHtmlFragment = renderTemplate(htmlTemplate, vars);
    const renderedText = renderTemplate(textTemplate, vars);
    const renderedHtml = wrapInBaseHtml({
      territory: row.accountTerritory,
      contentHtml: renderedHtmlFragment,
      preheader: `Service Agreement for ${row.customerCompanyName} — sign at your convenience.`,
    });

    // Render the agreement PDF.
    const pdfBuffer = await renderServiceAgreementPdf(
      agreementPdfDataFromRow(
        {
          id: agreementRow.id,
          status: "draft",
          quoteVersionId: row.id,
          versionNumber: row.versionNumber,
          accountTerritory: row.accountTerritory,
          customerCompanyName: row.customerCompanyName,
          customerAddress: row.customerAddress,
          customerContactName: row.customerContactName,
          customerContactEmail: row.customerContactEmail,
          customerContactPhone: row.accountPhone,
          customerSignedName: null,
          customerSignedAt: null,
          termStartDate: termStart.toISOString().slice(0, 10),
          termEndDate: termEnd.toISOString().slice(0, 10),
          senderFirstName: row.senderFirstName,
          senderLastName: row.senderLastName,
          senderEmail: row.senderEmail,
          createdAt: agreementRow.createdAt as Date,
        },
        lines,
      ),
    );

    // Snapshot the queued send.
    const [send] = await tx
      .insert(emailSends)
      .values({
        accountId: row.accountId,
        contactId: null,
        opportunityId: row.opportunityId,
        templateId: tpl?.id ?? null,
        fromEmail: sender.fromEmail,
        fromName: sender.fromName,
        toEmail: row.customerContactEmail,
        subject: renderedSubject,
        bodyHtml: renderedHtml,
        bodyText: renderedText,
        status: "queued",
        sentByUserId: session.sub,
      })
      .returning({ id: emailSends.id });

    return {
      kind: "ready" as const,
      serviceAgreementId: agreementRow.id,
      emailSendId: send.id,
      quoteVersionId: row.id,
      opportunityId: row.opportunityId,
      accountId: row.accountId,
      accountStatus: row.accountStatus,
      oppStage: row.oppStage,
      companyName: row.customerCompanyName,
      toEmail: row.customerContactEmail,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo:
        process.env.EMAIL_REPLY_TO || replyAddressFor(row.accountTerritory, send.id),
      pdfBuffer,
      pdfFilename: `Filta-ServiceAgreement-${vars.agreementRef}.pdf`,
    };
  });

  if (prep.kind === "error") return { ok: false, error: prep.error };
  if (prep.kind === "already_accepted") {
    return {
      ok: true,
      serviceAgreementId: prep.serviceAgreementId,
    };
  }

  // ---- network -----------------------------------------------------------
  const sendResult = await sendEmail({
    from: prep.fromEmail,
    fromName: prep.fromName,
    to: prep.toEmail,
    subject: prep.subject,
    html: prep.html,
    text: prep.text,
    replyTo: prep.replyTo,
    tags: [{ name: "campaign", value: "service_agreement" }],
    attachments: [
      {
        filename: prep.pdfFilename,
        content: prep.pdfBuffer.toString("base64"),
      },
    ],
  });

  // ---- TX2: finalize on success / mark failed otherwise ------------------
  const finalize = await withSession(session, async (tx) => {
    if (!sendResult.ok) {
      await tx
        .update(emailSends)
        .set({ status: "failed", providerError: sendResult.error })
        .where(eq(emailSends.id, prep.emailSendId));
      // Leave the agreement row in 'draft' so a retry from the UI just
      // re-runs the email send without rebuilding the agreement.
      return { kind: "failed" as const, error: sendResult.error };
    }

    const now = new Date();

    // 1. Mark the email_sends row sent
    await tx
      .update(emailSends)
      .set({
        status: "sent",
        providerMessageId: sendResult.providerMessageId,
        sentAt: now,
      })
      .where(eq(emailSends.id, prep.emailSendId));

    // 2. Mark the agreement sent + link the email
    await tx
      .update(serviceAgreements)
      .set({
        status: "sent",
        sentAt: now,
        sentEmailSendId: prep.emailSendId,
        updatedAt: now,
      })
      .where(eq(serviceAgreements.id, prep.serviceAgreementId));

    // 3. Mark the quote accepted
    await tx
      .update(quoteVersions)
      .set({
        status: "accepted",
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(quoteVersions.id, prep.quoteVersionId));

    // 4. Flip the account to customer (if it was a prospect) and stamp
    //    funnel stage. Already-customer accounts get the funnel update too
    //    so the win is recorded for analytics even on an upsell.
    await tx
      .update(accounts)
      .set({
        accountStatus: "customer",
        salesFunnelStage: "closed_won",
        salesFunnelStageChangedAt: now,
        convertedAt:
          prep.accountStatus === "prospect"
            ? now
            : sql`coalesce(${accounts.convertedAt}, ${now})`,
        updatedAt: now,
      })
      .where(eq(accounts.id, prep.accountId));

    // 5. Advance the parent opportunity to closed_won
    await tx
      .update(opportunities)
      .set({
        stage: "closed_won",
        stageChangedAt: now,
        actualCloseDate: now.toISOString().slice(0, 10),
        updatedAt: now,
      })
      .where(eq(opportunities.id, prep.opportunityId));

    // 6. Activity timeline entry
    await tx.insert(activities).values({
      accountId: prep.accountId,
      opportunityId: prep.opportunityId,
      type: "email",
      direction: "outbound",
      subject: `Sent: ${prep.subject}`,
      body: `Service Agreement emailed to ${prep.toEmail}. Quote accepted; account converted to customer.`,
      ownerUserId: session.sub,
    });

    // 7. First-visit onboarding task — high priority, due tomorrow.
    const followUpTaskId = await createAutoFollowUpTask(tx, {
      accountId: prep.accountId,
      opportunityId: prep.opportunityId,
      assigneeUserId: session.sub,
      title: `Schedule first visit at ${prep.companyName}`,
      notes: `Auto-created on quote acceptance. Confirm a start date with the customer and add to the route.`,
      daysOut: FIRST_VISIT_FOLLOW_UP_DAYS,
      autoSource: "onboarding_first_visit_v1",
    });

    return { kind: "sent" as const, followUpTaskId };
  });

  revalidatePath("/pipeline");
  revalidatePath("/today");
  revalidatePath(`/accounts/${prep.accountId}`);
  revalidatePath(`/opportunities/${prep.opportunityId}/quote`);
  revalidatePath("/cross-sell");
  revalidatePath("/at-risk");

  if (finalize.kind === "failed") {
    return {
      ok: false,
      error: finalize.error ?? "Send failed (agreement saved as draft)",
      serviceAgreementId: prep.serviceAgreementId,
      emailSendId: prep.emailSendId,
    };
  }

  return {
    ok: true,
    serviceAgreementId: prep.serviceAgreementId,
    emailSendId: prep.emailSendId,
    followUpTaskId: finalize.followUpTaskId,
    devStub: sendResult.ok ? sendResult.devStub : undefined,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// quotePdfDataFromRow lives in src/lib/pdf/quote-data.ts so both this
// action file (in TX1) and the /api/quotes/[id]/pdf route can call it.
// Server-action files can only export async functions, so the sync helper
// has to live elsewhere.
