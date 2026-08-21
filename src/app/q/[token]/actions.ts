"use server";

// Public server actions for /q/[token] — Accept and Decline.
//
// These run WITHOUT a CRM session — auth is the token in the URL plus the
// hash check. We use the no-RLS `db` handle directly because there's no
// app.user_id to set, and the RLS policies on accounts/opps would block
// us. The token-by-hash lookup is the security boundary.
//
// On accept: mirrors the rep-side acceptQuoteAction in
// src/app/(authed)/quotes/actions.ts — creates the service_agreement,
// generates a fresh agreement token, emails the agreement PDF to the
// customer, flips the account to customer, advances the opp to
// closed_won, creates a "Schedule first visit" task. Returns the
// agreement token so the client can redirect to /a/[token] for
// immediate signature.
//
// On decline: marks the quote 'declined' + writes a 'Customer declined'
// activity for the rep's timeline. No agreement is generated.

import crypto from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  accounts,
  activities,
  emailSends,
  messageTemplates,
  opportunities,
  quoteLineItems,
  quoteVersions,
  serviceAgreements,
  tasks,
  users,
} from "@/db";
import { sendEmail } from "@/lib/resend";
import {
  renderTemplate,
  replyAddressFor,
  senderIdentityFor,
  wrapInBaseHtml,
} from "@/lib/email-templates";
import { renderServiceAgreementPdf } from "@/lib/pdf/ServiceAgreementDocument";
import { agreementPdfDataFromRow } from "@/lib/pdf/agreement-data";
import {
  generatePublicToken,
  loadQuoteByToken,
  publicAgreementUrl,
} from "@/lib/public-tokens";

const Input = z.object({
  token: z.string().min(10),
});

export type AcceptResult =
  | { ok: true; agreementToken?: string; devStub?: boolean }
  | { ok: false; error: string };

const FIRST_VISIT_FOLLOW_UP_DAYS = 1;
const INITIAL_TERM_YEARS = 3;

/**
 * Customer-side accept. Public — no session required.
 * Mirrors the rep-side acceptQuoteAction but token-authed.
 */
export async function acceptQuotePublicAction(
  input: z.infer<typeof Input>,
): Promise<AcceptResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid token" };

  // Resolve the token. Idempotency: if quote is already accepted, return
  // the existing agreement's token so the user lands on the sign page.
  const quote = await loadQuoteByToken(parsed.data.token);
  if (!quote) {
    return { ok: false, error: "This link has expired or is no longer valid" };
  }
  if (quote.status === "accepted") {
    // Idempotent — already accepted is a no-op success. Intentionally do
    // NOT rotate the agreement token: the original sign link is already
    // in the customer's welcome email and rotating would silently break
    // it. Returning without an agreementToken triggers router.refresh()
    // on the client, which redraws /q/[token] in its "accepted" state
    // (the green banner). Customer uses the link from their email to
    // get to /a/[token].
    return { ok: true };
  }
  if (quote.status !== "sent") {
    return {
      ok: false,
      error: `This proposal can't be accepted right now (status: ${quote.status})`,
    };
  }

  // Pull the parent opportunity + account + sender so we have the same
  // context the rep-side action does.
  const [meta] = await db
    .select({
      opportunityId: quoteVersions.opportunityId,
      accountId: opportunities.accountId,
      accountStatus: accounts.accountStatus,
      accountTerritory: accounts.territory,
      accountPhone: accounts.phone,
      oppStage: opportunities.stage,
      createdByUserId: quoteVersions.createdByUserId,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(quoteVersions)
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
    .where(eq(quoteVersions.id, quote.id))
    .limit(1);

  if (!meta) return { ok: false, error: "Quote context not found" };
  if (!quote.customerContactEmail) {
    return { ok: false, error: "No contact email on file" };
  }

  // Pull line items for the agreement PDF render.
  const lines = await db
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteVersionId, quote.id))
    .orderBy(asc(quoteLineItems.displayOrder));

  // Term dates — 3-year initial term per corporate template.
  const termStart = new Date();
  const termEnd = new Date(termStart);
  termEnd.setUTCFullYear(termEnd.getUTCFullYear() + INITIAL_TERM_YEARS);

  // Generate a fresh agreement token NOW so we can include the sign link
  // in the welcome email AND return it to the client for redirect.
  const agreementLink = generatePublicToken();

  // Insert the service_agreement row in 'draft'. The PDF render reads
  // from this row's id for the agreement reference number.
  const [agreementRow] = await db
    .insert(serviceAgreements)
    .values({
      quoteVersionId: quote.id,
      accountId: meta.accountId,
      status: "draft",
      termStartDate: termStart.toISOString().slice(0, 10),
      termEndDate: termEnd.toISOString().slice(0, 10),
      sentToEmail: quote.customerContactEmail,
      publicTokenHash: agreementLink.hash,
      publicTokenExpiresAt: agreementLink.expiresAt,
      // Use the rep who created the quote as the agreement's creator.
      createdByUserId: meta.createdByUserId,
    })
    .returning({
      id: serviceAgreements.id,
      createdAt: serviceAgreements.createdAt,
    });

  // Resolve the welcome template (falls back to a hardcoded one).
  const [tpl] = await db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.key, "service_agreement_v1"),
        eq(messageTemplates.active, true),
      ),
    )
    .limit(1);

  const sender = senderIdentityFor(meta.accountTerritory);
  const senderFirstName = meta.senderFirstName ?? sender.fromName;
  const senderFullName =
    [meta.senderFirstName, meta.senderLastName].filter(Boolean).join(" ") ||
    sender.fromName;

  const vars = {
    firstName: quote.customerContactName?.split(" ")[0] || "there",
    companyName: quote.customerCompanyName,
    senderFirstName,
    senderFullName,
    territoryLabel: sender.territoryLabel,
    agreementRef: `SA-${agreementRow.id.slice(0, 6)}`,
    customerLink: publicAgreementUrl(agreementLink.token),
  };

  const subjectTemplate =
    tpl?.subjectTemplate ??
    "Welcome to Filta — your service agreement is attached";
  const htmlTemplate =
    tpl?.bodyHtmlTemplate ??
    `<p>Hi {{firstName}},</p><p>Thanks for accepting. Attached is the Service Agreement for <strong>{{companyName}}</strong>.</p>`;
  const textTemplate =
    tpl?.bodyTextTemplate ??
    `Hi {{firstName}}, thanks for accepting. Attached is the Service Agreement for {{companyName}}.`;

  const renderedSubject = renderTemplate(subjectTemplate, vars);
  const renderedHtmlFragment = renderTemplate(htmlTemplate, vars);
  const renderedText = renderTemplate(textTemplate, vars);
  const renderedHtml = wrapInBaseHtml({
    territory: meta.accountTerritory,
    contentHtml: renderedHtmlFragment,
    preheader: `Service Agreement for ${quote.customerCompanyName} — sign at your convenience.`,
  });

  // Render the PDF.
  const pdfBuffer = await renderServiceAgreementPdf(
    agreementPdfDataFromRow(
      {
        id: agreementRow.id,
        status: "draft",
        quoteVersionId: quote.id,
        versionNumber: quote.versionNumber,
        accountTerritory: meta.accountTerritory,
        customerCompanyName: quote.customerCompanyName,
        customerAddress: quote.customerAddress,
        customerContactName: quote.customerContactName,
        customerContactEmail: quote.customerContactEmail,
        customerContactPhone: meta.accountPhone,
        customerSignedName: null,
        customerSignedAt: null,
        termStartDate: termStart.toISOString().slice(0, 10),
        termEndDate: termEnd.toISOString().slice(0, 10),
        senderFirstName: meta.senderFirstName,
        senderLastName: meta.senderLastName,
        senderEmail: meta.senderEmail,
        createdAt: agreementRow.createdAt as Date,
      },
      lines,
    ),
  );

  // Insert the queued email_sends row and dispatch.
  const [send] = await db
    .insert(emailSends)
    .values({
      accountId: meta.accountId,
      contactId: null,
      opportunityId: meta.opportunityId,
      templateId: tpl?.id ?? null,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      toEmail: quote.customerContactEmail,
      subject: renderedSubject,
      bodyHtml: renderedHtml,
      bodyText: renderedText,
      status: "queued",
      sentByUserId: meta.createdByUserId,
    })
    .returning({ id: emailSends.id });

  const sendResult = await sendEmail({
    from: sender.fromEmail,
    fromName: sender.fromName,
    to: quote.customerContactEmail,
    subject: renderedSubject,
    html: renderedHtml,
    text: renderedText,
    replyTo:
      process.env.EMAIL_REPLY_TO ||
      replyAddressFor(meta.accountTerritory, send.id),
    tags: [
      { name: "campaign", value: "service_agreement" },
      { name: "source", value: "public_accept" },
    ],
    attachments: [
      {
        filename: `Filta-ServiceAgreement-${vars.agreementRef}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });

  // Finalize regardless of email outcome — quote is accepted either way.
  // If the email failed, the agreement still exists; rep can resend.
  const now = new Date();
  await db.transaction(async (tx) => {
    if (sendResult.ok) {
      await tx
        .update(emailSends)
        .set({
          status: "sent",
          providerMessageId: sendResult.providerMessageId,
          sentAt: now,
        })
        .where(eq(emailSends.id, send.id));
      await tx
        .update(serviceAgreements)
        .set({
          status: "sent",
          sentAt: now,
          sentEmailSendId: send.id,
          updatedAt: now,
        })
        .where(eq(serviceAgreements.id, agreementRow.id));
    } else {
      await tx
        .update(emailSends)
        .set({ status: "failed", providerError: sendResult.error })
        .where(eq(emailSends.id, send.id));
    }

    // Mark the quote accepted.
    await tx
      .update(quoteVersions)
      .set({ status: "accepted", acceptedAt: now, updatedAt: now })
      .where(eq(quoteVersions.id, quote.id));

    // Flip account to customer.
    await tx
      .update(accounts)
      .set({
        accountStatus: "customer",
        salesFunnelStage: "closed_won",
        salesFunnelStageChangedAt: now,
        convertedAt:
          meta.accountStatus === "prospect"
            ? now
            : sql`coalesce(${accounts.convertedAt}, ${now})`,
        updatedAt: now,
      })
      .where(eq(accounts.id, meta.accountId));

    // Close the opp.
    await tx
      .update(opportunities)
      .set({
        stage: "closed_won",
        stageChangedAt: now,
        actualCloseDate: now.toISOString().slice(0, 10),
        updatedAt: now,
      })
      .where(eq(opportunities.id, meta.opportunityId));

    // Activity row.
    await tx.insert(activities).values({
      accountId: meta.accountId,
      opportunityId: meta.opportunityId,
      type: "note",
      direction: "inbound",
      subject: "Customer accepted proposal online",
      body: `Quote v${quote.versionNumber} accepted via /q/[token]. Service Agreement generated and emailed${sendResult.ok ? "" : " (email send failed: " + sendResult.error + ")"}.`,
      ownerUserId: meta.createdByUserId,
    });

    // First-visit task. Computed inline rather than calling
    // createAutoFollowUpTask because that helper expects a withSession tx.
    const due = new Date();
    due.setUTCHours(0, 0, 0, 0);
    due.setUTCDate(due.getUTCDate() + FIRST_VISIT_FOLLOW_UP_DAYS);
    await tx.insert(tasks).values({
      accountId: meta.accountId,
      opportunityId: meta.opportunityId,
      assigneeUserId: meta.createdByUserId,
      title: `Schedule first visit at ${quote.customerCompanyName}`,
      notes: `Auto-created on customer acceptance via the public quote link.`,
      dueDate: due.toISOString().slice(0, 10),
      priority: "normal",
      createdByUserId: meta.createdByUserId,
      autoSource: "onboarding_first_visit_v1",
    });
  });

  // Refresh rep-side surfaces.
  revalidatePath(`/accounts/${meta.accountId}`);
  revalidatePath(`/opportunities/${meta.opportunityId}`);
  revalidatePath(`/opportunities/${meta.opportunityId}/quote`);
  revalidatePath("/pipeline");
  revalidatePath("/today");
  revalidatePath("/cross-sell");

  return {
    ok: true,
    agreementToken: agreementLink.token,
    devStub: sendResult.ok ? sendResult.devStub : undefined,
  };
}

// ============================================================================
// DECLINE
// ============================================================================

const DeclineInput = z.object({
  token: z.string().min(10),
  reason: z.string().max(1000).optional(),
});

export async function declineQuotePublicAction(
  input: z.infer<typeof DeclineInput>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = DeclineInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const quote = await loadQuoteByToken(parsed.data.token);
  if (!quote) {
    return { ok: false, error: "This link has expired or is no longer valid" };
  }
  if (quote.status !== "sent") {
    return {
      ok: false,
      error: `This proposal can't be declined right now (status: ${quote.status})`,
    };
  }

  // Look up the rep + account/opp ids for the activity row.
  const [meta] = await db
    .select({
      accountId: opportunities.accountId,
      opportunityId: quoteVersions.opportunityId,
      createdByUserId: quoteVersions.createdByUserId,
    })
    .from(quoteVersions)
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .where(eq(quoteVersions.id, quote.id))
    .limit(1);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(quoteVersions)
      .set({
        status: "declined",
        declinedAt: now,
        updatedAt: now,
      })
      .where(eq(quoteVersions.id, quote.id));

    if (meta) {
      await tx.insert(activities).values({
        accountId: meta.accountId,
        opportunityId: meta.opportunityId,
        type: "note",
        direction: "inbound",
        subject: "Customer declined proposal online",
        body: parsed.data.reason
          ? `Reason: ${parsed.data.reason}`
          : "No reason provided.",
        ownerUserId: meta.createdByUserId,
      });
    }
  });

  if (meta) {
    revalidatePath(`/accounts/${meta.accountId}`);
    revalidatePath(`/opportunities/${meta.opportunityId}`);
    revalidatePath(`/opportunities/${meta.opportunityId}/quote`);
    revalidatePath("/pipeline");
  }

  return { ok: true };
}

// Touch the headers import so the bundler doesn't tree-shake it; we may
// use it in a future audit-log enhancement and want to keep the import
// stable.
void headers;
// Touch crypto so the import isn't flagged unused.
void crypto;
