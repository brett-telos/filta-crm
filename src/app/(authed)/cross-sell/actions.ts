"use server";

// Server actions for the FiltaClean cross-sell dashboard.
//
// Two flows live here:
//
//   1. createFsOpportunityAction — one-click "create an FS opp" from a target
//      row. Estimates annual value as FF monthly × 4 (the ratio we saw across
//      the 5 current FS customers; ~1/3 of annual FF revenue). Rep can
//      override on the opp detail page later.
//
//   2. sendFsCrossSellEmailAction — one-click branded email send to the
//      account's primary contact using the `fs_cross_sell_v1` template.
//      On success, logs an email_sends row, writes an outbound "email"
//      activity to the timeline, and auto-creates a 5-day follow-up task so
//      the rep doesn't have to remember to check back in.

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  activities,
  contacts,
  emailSends,
  messageTemplates,
  opportunities,
  users,
  withSession,
} from "@/db";
import { requireSession } from "@/lib/session";
import { sendEmail } from "@/lib/resend";
import {
  renderTemplate,
  senderIdentityFor,
  wrapInBaseHtml,
} from "@/lib/email-templates";
import { createAutoFollowUpTask } from "../tasks/actions";

const Input = z.object({
  accountId: z.string().uuid(),
});

export type CreateFsResult = {
  ok: boolean;
  error?: string;
  opportunityId?: string;
};

// Ballpark: FS annual = FF monthly × 4. Tune after first wins.
const FS_ESTIMATE_MULTIPLIER = 4;

export async function createFsOpportunityAction(
  input: z.infer<typeof Input>,
): Promise<CreateFsResult> {
  const session = await requireSession();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  // Run the entire read-check-insert flow inside one RLS-bound transaction so
  // that a cross-territory insert is rejected by the DB even if the explicit
  // check below is bypassed.
  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.accountId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return { ok: false, error: "Account not found" };

    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    // Idempotency: if there's already an open FS opp, return it rather than
    // creating a duplicate.
    const existing = await tx
      .select({ id: opportunities.id, stage: opportunities.stage })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.accountId, acct.id),
          eq(opportunities.serviceType, "fs"),
          isNull(opportunities.deletedAt),
        ),
      );

    const openExisting = existing.find(
      (e) => e.stage !== "closed_won" && e.stage !== "closed_lost",
    );
    if (openExisting) {
      return { ok: true, opportunityId: openExisting.id };
    }

    const sp = (acct.serviceProfile as Record<string, any>) ?? {};
    const ffMonthly = Number(sp?.ff?.monthly_revenue ?? 0);
    const estimate = ffMonthly > 0 ? ffMonthly * FS_ESTIMATE_MULTIPLIER : null;

    const [inserted] = await tx
      .insert(opportunities)
      .values({
        accountId: acct.id,
        name: `${acct.companyName} — FiltaClean`,
        serviceType: "fs",
        stage: "new_lead",
        estimatedValueAnnual: estimate ? estimate.toFixed(2) : null,
        ownerUserId: acct.ownerUserId ?? session.sub,
      })
      .returning({ id: opportunities.id });

    revalidatePath("/cross-sell");
    revalidatePath("/pipeline");
    revalidatePath(`/accounts/${acct.id}`);

    return { ok: true, opportunityId: inserted.id };
  });
}

// ============================================================================
// SEND FS CROSS-SELL EMAIL
// ============================================================================

const SendEmailInput = z.object({
  accountId: z.string().uuid(),
  // Optional — if the caller has already picked a specific contact (e.g. from
  // a dropdown), we honor it. Otherwise we default to the account's primary
  // contact, falling back to the first contact with an email.
  contactId: z.string().uuid().optional(),
  // Optional — if the caller has an open FS opp, linking the send to it
  // makes the history card on the opp detail page more useful later.
  opportunityId: z.string().uuid().optional(),
  // Which template key to use. Defaults to v1 but leaves headroom for an
  // A/B test later.
  templateKey: z.string().min(1).default("fs_cross_sell_v1"),
});

export type SendFsCrossSellResult = {
  ok: boolean;
  error?: string;
  emailSendId?: string;
  followUpTaskId?: string;
  devStub?: boolean; // true when no RESEND_API_KEY is set
};

// Default cadence for the auto follow-up task created on successful send.
// 5 days hits the kitchen owner's next quieter admin day without feeling
// pushy. Tune after we see response rates.
const FOLLOW_UP_DAYS = 5;

/**
 * Send the FS cross-sell email for `accountId` and record it everywhere the
 * history matters:
 *  - `email_sends` row with the rendered subject/html/text snapshot and the
 *    Resend provider message id
 *  - `activities` row (type=email, direction=outbound) so the account
 *    timeline shows "Email sent: ..."
 *  - a 5-day follow-up `tasks` row assigned to the sending user
 *
 * The Resend call happens BETWEEN two small transactions:
 *  TX1: look up account/contact/template/user + insert the email_sends row
 *       in 'queued' state (captures the immutable snapshot).
 *  TX2 (only on success): update status to 'sent', write activity, create
 *       follow-up task.
 *  TX2' (only on failure): update status to 'failed' with the error string.
 *
 * Splitting into two transactions keeps the DB connection free while Resend
 * is being called, and makes failure states observable (a stuck 'queued' row
 * means the server was killed mid-send — recoverable by hand until we build
 * a sweeper).
 */
export async function sendFsCrossSellEmailAction(
  input: z.infer<typeof SendEmailInput>,
): Promise<SendFsCrossSellResult> {
  const session = await requireSession();
  const parsed = SendEmailInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { accountId, contactId, opportunityId, templateKey } = parsed.data;

  // --------------------------------------------------------
  // TX1: read-through + insert queued email_sends row
  // --------------------------------------------------------
  const prep = await withSession(session, async (tx) => {
    // Account + territory check (RLS enforces this too; the friendlier error
    // surfaces here first).
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!acct) return { kind: "error" as const, error: "Account not found" };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { kind: "error" as const, error: "Access denied" };
    }

    // Contact resolution. If caller supplied one, trust it (after account
    // match check). Otherwise pick primary, else most recently updated
    // contact with a non-empty email.
    let contact;
    if (contactId) {
      const [c] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.accountId, acct.id)))
        .limit(1);
      if (!c) return { kind: "error" as const, error: "Contact not found on account" };
      contact = c;
    } else {
      // Prefer is_primary=true; within that (or as fallback) prefer contacts
      // that actually have an email.
      const candidates = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.accountId, acct.id), isNull(contacts.deletedAt)))
        .orderBy(desc(contacts.isPrimary), desc(contacts.updatedAt));
      contact = candidates.find((c) => c.email && c.email.trim().length > 0);
    }
    if (!contact || !contact.email) {
      return {
        kind: "error" as const,
        error: "No contact with email on this account",
      };
    }

    // Template lookup. Active flag respected so an operator can disable a
    // template in prod without deleting the row.
    const [tpl] = await tx
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.key, templateKey),
          eq(messageTemplates.active, true),
        ),
      )
      .limit(1);
    if (!tpl) {
      return { kind: "error" as const, error: `Template "${templateKey}" not found` };
    }

    // Sender identity derived from the account's territory, not the user's
    // scope — "both" users should send as the kitchen's own territory so the
    // reply-to makes sense to the recipient.
    const sender = senderIdentityFor(acct.territory);

    // Sending user — for the signature.
    const [sendingUser] = await tx
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, session.sub))
      .limit(1);
    const senderFirstName = sendingUser?.firstName ?? sender.fromName;

    // Variable substitution. `firstName` falls back to "there" when the
    // contact has no first name — keeps the salutation readable.
    const vars = {
      firstName:
        contact.firstName && contact.firstName.trim().length > 0
          ? contact.firstName.trim()
          : "there",
      companyName: acct.companyName,
      senderFirstName,
      senderFullName: sendingUser
        ? `${sendingUser.firstName} ${sendingUser.lastName}`.trim()
        : sender.fromName,
      territoryLabel: sender.territoryLabel,
    };

    const renderedSubject = renderTemplate(tpl.subjectTemplate, vars);
    const renderedTextBody = renderTemplate(tpl.bodyTextTemplate, vars);
    const renderedHtmlFragment = renderTemplate(tpl.bodyHtmlTemplate, vars);
    const renderedHtml = wrapInBaseHtml({
      territory: acct.territory,
      contentHtml: renderedHtmlFragment,
      preheader: `FiltaClean hood deep-clean — a quick note from ${sender.fromName}.`,
    });

    // Snapshot the send into email_sends as 'queued'. This row is the
    // source-of-truth history entry even if Resend never accepts the call.
    const [row] = await tx
      .insert(emailSends)
      .values({
        accountId: acct.id,
        contactId: contact.id,
        opportunityId: opportunityId ?? null,
        templateId: tpl.id,
        fromEmail: sender.fromEmail,
        fromName: sender.fromName,
        toEmail: contact.email,
        subject: renderedSubject,
        bodyHtml: renderedHtml,
        bodyText: renderedTextBody,
        status: "queued",
        sentByUserId: session.sub,
      })
      .returning({ id: emailSends.id });

    return {
      kind: "ready" as const,
      emailSendId: row.id,
      accountId: acct.id,
      opportunityId: opportunityId ?? null,
      companyName: acct.companyName,
      toEmail: contact.email,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedTextBody,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo: process.env.EMAIL_REPLY_TO || sender.fromEmail,
    };
  });

  if (prep.kind === "error") return { ok: false, error: prep.error };

  // --------------------------------------------------------
  // Network call — OUTSIDE any transaction.
  // --------------------------------------------------------
  const sendResult = await sendEmail({
    from: prep.fromEmail,
    fromName: prep.fromName,
    to: prep.toEmail,
    subject: prep.subject,
    html: prep.html,
    text: prep.text,
    replyTo: prep.replyTo,
    tags: [
      { name: "campaign", value: "fs_cross_sell" },
      { name: "template", value: templateKey },
    ],
  });

  // --------------------------------------------------------
  // TX2: finalize status + (on success) activity + follow-up task
  // --------------------------------------------------------
  const finalize = await withSession(session, async (tx) => {
    if (!sendResult.ok) {
      await tx
        .update(emailSends)
        .set({ status: "failed", providerError: sendResult.error })
        .where(eq(emailSends.id, prep.emailSendId));
      return { kind: "failed" as const, error: sendResult.error };
    }

    await tx
      .update(emailSends)
      .set({
        status: "sent",
        providerMessageId: sendResult.providerMessageId,
        sentAt: new Date(),
      })
      .where(eq(emailSends.id, prep.emailSendId));

    // Timeline: outbound email activity. Body is intentionally short — the
    // full HTML/text snapshot lives on email_sends, not activities, to keep
    // the timeline scannable.
    await tx.insert(activities).values({
      accountId: prep.accountId,
      opportunityId: prep.opportunityId ?? undefined,
      type: "email",
      direction: "outbound",
      subject: `Sent: ${prep.subject}`,
      body: `FS cross-sell email sent to ${prep.toEmail}.`,
      ownerUserId: session.sub,
    });

    // Auto follow-up task — 5 days out, assigned to the sender, tagged so
    // we can find auto-generated rows later for tuning.
    const followUpTitle = `Follow up on FiltaClean email to ${prep.companyName}`;
    const followUpTaskId = await createAutoFollowUpTask(tx, {
      accountId: prep.accountId,
      opportunityId: prep.opportunityId ?? null,
      assigneeUserId: session.sub,
      title: followUpTitle,
      notes: `Auto-created after sending "${prep.subject}" to ${prep.toEmail}.`,
      daysOut: FOLLOW_UP_DAYS,
      autoSource: "fs_cross_sell_email_v1",
    });

    return { kind: "sent" as const, followUpTaskId };
  });

  // Refresh every surface that might show this now.
  revalidatePath("/cross-sell");
  revalidatePath("/today");
  revalidatePath(`/accounts/${prep.accountId}`);
  if (prep.opportunityId) revalidatePath("/pipeline");

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
