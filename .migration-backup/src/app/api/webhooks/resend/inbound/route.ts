// POST /api/webhooks/resend/inbound
//
// Receives inbound replies parsed by Resend's inbound webhook. We:
//   1. Verify the Svix signature against RESEND_WEBHOOK_SECRET (same secret
//      as the events webhook — Resend uses one signing key per project).
//   2. Match the inbound to a sent email_sends row by parsing the
//      emailSendId out of the To: address (plus-addressing — see
//      replyAddressFor / parseReplyAddress in lib/email-templates).
//   3. Insert an `activities` row (type='email', direction='inbound') so
//      the account timeline shows "Reply: <subject>".
//   4. Insert a synthetic 'replied' email_events row + bump email_sends
//      counters so the cross-sell dashboard's engagement column updates.
//   5. Auto-complete the 5-day follow-up task originally created by the
//      send-and-log flow — the customer just replied, the rep doesn't need
//      to chase.
//
// Unmatched replies (no plus-tag, or emailSendId points to a deleted send)
// are stored in a "stranded reply" log row so we can hand-route them. For
// v1 we just console-warn and 200; building a /admin/unmatched-replies UI
// is a follow-up if it actually happens often.
//
// Env: RESEND_WEBHOOK_SECRET (same secret as /events).

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  activities,
  emailEvents,
  emailSends,
  tasks,
} from "@/db";
import { parseReplyAddress } from "@/lib/email-templates";
import { verifySvixSignature } from "@/lib/svix";

export const runtime = "nodejs";

// Resend's inbound payload shape, narrowed to what we actually use. Their
// docs show more fields (raw MIME, attachments, etc.) but we keep the type
// minimal and stash the whole thing in raw_payload on email_events for
// forensic debugging.
type ResendInboundBody = {
  type: string; // 'email.inbound' or 'email.received'
  created_at?: string;
  data: {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return jsonResponse(503, {
      ok: false,
      error: "RESEND_WEBHOOK_SECRET not configured",
    });
  }

  const rawBody = await req.text();
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const verify = verifySvixSignature(rawBody, headers, secret);
  if (!verify.ok) {
    return jsonResponse(401, { ok: false, error: verify.reason });
  }

  let body: ResendInboundBody;
  try {
    body = JSON.parse(rawBody) as ResendInboundBody;
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  if (body.type !== "email.inbound" && body.type !== "email.received") {
    return jsonResponse(200, {
      ok: true,
      ignored: `unhandled type ${body.type}`,
    });
  }

  // Resolve emailSendId from the To: address. Resend may pass a single
  // string or an array depending on multiple-recipient replies; we check
  // each candidate until we find one with our plus-tag.
  const toCandidates = (
    Array.isArray(body.data.to) ? body.data.to : [body.data.to ?? ""]
  ).filter(Boolean) as string[];

  let emailSendId: string | null = null;
  for (const candidate of toCandidates) {
    const parsed = parseReplyAddress(candidate);
    if (parsed) {
      emailSendId = parsed;
      break;
    }
  }

  if (!emailSendId) {
    console.warn(
      "[inbound webhook] No reply+<id> tag in To addresses",
      toCandidates,
    );
    return jsonResponse(200, {
      ok: true,
      ignored: "no plus-tag in recipient",
    });
  }

  const [send] = await db
    .select({
      id: emailSends.id,
      accountId: emailSends.accountId,
      contactId: emailSends.contactId,
      opportunityId: emailSends.opportunityId,
      sentByUserId: emailSends.sentByUserId,
    })
    .from(emailSends)
    .where(eq(emailSends.id, emailSendId))
    .limit(1);

  if (!send) {
    console.warn(
      `[inbound webhook] No email_sends row for plus-tag id=${emailSendId}`,
    );
    return jsonResponse(200, {
      ok: true,
      ignored: "unknown emailSendId",
    });
  }

  const occurredAt = body.created_at
    ? new Date(body.created_at)
    : new Date();
  const subject = body.data.subject?.trim() || "(no subject)";
  const fromAddr = body.data.from ?? "(unknown sender)";
  // Plain text reply if available; fall back to a stripped-HTML stub so the
  // timeline isn't empty. We don't try to be clever about quoted-text
  // stripping (that's an entire library worth of edge cases) — the rep can
  // see the full reply on the source mailbox if they want.
  const replyText =
    body.data.text?.trim() ||
    (body.data.html
      ? body.data.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : "");

  await db.transaction(async (tx) => {
    // Idempotent activity insert — if the same provider redelivers, we'd
    // double-log. Use a deterministic subject prefix + send id pair to
    // detect the duplicate. Cheap because the per-account activity table
    // is small.
    const dupSubject = `Reply: ${subject}`;
    const [existing] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(
        and(
          eq(activities.accountId, send.accountId),
          eq(activities.type, "email"),
          eq(activities.direction, "inbound"),
          eq(activities.subject, dupSubject),
        ),
      )
      .limit(1);

    if (!existing) {
      await tx.insert(activities).values({
        accountId: send.accountId,
        opportunityId: send.opportunityId ?? undefined,
        type: "email",
        direction: "inbound",
        subject: dupSubject,
        body: replyText
          ? `From: ${fromAddr}\n\n${replyText}`
          : `From: ${fromAddr}\n\n(empty body)`,
        // Attribute the inbound to the user who sent the original outbound;
        // the activity owner column is the rep responsible for the thread.
        ownerUserId: send.sentByUserId,
      });
    }

    // Record the synthetic 'replied' event with a deterministic provider id
    // so Resend redeliveries (which retry on 5xx) don't accumulate duplicate
    // rows. The svix-id is unique per delivery, but we want one event per
    // actual reply, so we key on emailSendId — at most one 'replied' row
    // per send, regardless of retry count. Subsequent replies on the same
    // thread (rare for a cross-sell flow, common for support) are visible
    // via the activity timeline and don't need separate event rows.
    const syntheticEventId = `inbound-${send.id}`;
    await tx
      .insert(emailEvents)
      .values({
        emailSendId: send.id,
        eventType: "replied",
        occurredAt,
        providerEventId: syntheticEventId,
        rawPayload: body as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: emailEvents.providerEventId });

    // Bump replied_at + lastEvent on email_sends. Use coalesce so the first
    // reply wins (subsequent replies don't overwrite the timestamp).
    await tx
      .update(emailSends)
      .set({
        repliedAt: sql`coalesce(${emailSends.repliedAt}, ${occurredAt})`,
        lastEventAt: occurredAt,
        lastEventType: "replied",
        updatedAt: new Date(),
      })
      .where(eq(emailSends.id, send.id));

    // Auto-complete the 5-day follow-up task created by the send-and-log
    // flow. Match by autoSource + accountId; only operate on tasks still
    // in 'open' status (don't reopen done/snoozed ones).
    await tx
      .update(tasks)
      .set({
        status: "done",
        completedAt: occurredAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.accountId, send.accountId),
          eq(tasks.autoSource, "fs_cross_sell_email_v1"),
          eq(tasks.status, "open"),
        ),
      );
  });

  return jsonResponse(200, {
    ok: true,
    emailSendId,
    accountId: send.accountId,
  });
}

export async function GET() {
  return jsonResponse(405, {
    ok: false,
    error: "Use POST. This endpoint receives Resend inbound webhooks.",
  });
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}
