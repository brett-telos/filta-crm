// POST /api/webhooks/resend/events
//
// Resend → Svix → us. Each delivery / open / click / bounce / complaint
// gets posted here. We:
//   1. Verify the Svix signature against RESEND_WEBHOOK_SECRET (drops
//      anything we can't authenticate before we touch the DB).
//   2. Parse the event type and the parent `email_id` (Resend's
//      provider_message_id, the one we stored on email_sends.providerMessageId
//      back in the cross-sell action).
//   3. Look up the email_sends row by that provider_message_id.
//   4. Idempotently insert an email_events row (keyed on the Resend event id).
//   5. Update email_sends counters + status timestamps in the same TX so
//      the list-page renders are JOIN-free.
//
// Idempotency matters because Resend retries on non-2xx, and even successful
// deliveries can be re-sent during their dashboard "replay" feature. The
// unique index on email_events.provider_event_id guarantees we only count
// each event once.
//
// Always returns 2xx (or 200 with an explanatory body) once auth passes.
// If the email_sends row can't be found (provider_message_id mismatch), we
// log and return 200 — Resend retrying won't fix the problem and we don't
// want endless redelivery.
//
// Auth-fail / signature-fail → 401, which Resend will retry briefly and
// then surface in the dashboard. Helpful for catching DNS/secret typos.
//
// Env: RESEND_WEBHOOK_SECRET — set in Replit secrets to the value Resend
// shows in the webhook config UI. If missing, we 503 — better than silently
// accepting unsigned traffic.

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, emailEvents, emailSends } from "@/db";
import { verifySvixSignature } from "@/lib/svix";

export const runtime = "nodejs"; // crypto + raw body need Node runtime

// Map Resend event names → our internal email_event_type enum.
// Resend emits names like "email.delivered", "email.opened", etc.
//
// `email.delivery_delayed` is intentionally NOT mapped: it means "still in
// flight, retrying" — not the same as delivered. We let it fall through as
// `ignored` rather than misrepresent the send status. If it converts to a
// real delivered or bounced afterward, we'll get that event too and update
// status correctly then.
const RESEND_EVENT_MAP: Record<
  string,
  "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed"
> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

type ResendEventBody = {
  type: string;
  created_at: string; // ISO
  // Resend's per-event id (e.g. 'evt_...'). Distinct from the svix-id
  // header — svix-id is unique per webhook DELIVERY (changes on retry),
  // while this id is unique per logical EVENT (stable across retries).
  // Some Resend payload shapes nest it under data.id; we accept both.
  id?: string;
  data: {
    id?: string;
    email_id?: string; // matches email_sends.provider_message_id
    // Click events expose the URL that was clicked
    click?: { link?: string };
    // Open events sometimes include user-agent etc; we keep the whole thing
    // in raw_payload for debugging.
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

  // Read body as raw text — JSON.parse mutates whitespace and would break
  // signature verification.
  const rawBody = await req.text();

  // Headers are stored lowercase in fetch's Request, but Svix capitalizes
  // theirs. We collect a small set into a lowered map for the verifier.
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const verify = verifySvixSignature(rawBody, headers, secret);
  if (!verify.ok) {
    // 401 so Resend retries and surfaces the failure in their dashboard.
    return jsonResponse(401, { ok: false, error: verify.reason });
  }

  let body: ResendEventBody;
  try {
    body = JSON.parse(rawBody) as ResendEventBody;
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  const eventType = RESEND_EVENT_MAP[body.type];
  if (!eventType) {
    // Not a type we care about. Acknowledge so Resend stops retrying.
    return jsonResponse(200, {
      ok: true,
      ignored: `unhandled type ${body.type}`,
    });
  }

  const providerMessageId = body.data?.email_id;
  if (!providerMessageId) {
    return jsonResponse(200, {
      ok: true,
      ignored: "no email_id in payload",
    });
  }

  // Resolve to our send row. If we can't, log and 200 — there's no recovery
  // and Resend retrying won't surface a different message_id.
  const [send] = await db
    .select({ id: emailSends.id })
    .from(emailSends)
    .where(eq(emailSends.providerMessageId, providerMessageId))
    .limit(1);

  if (!send) {
    console.warn(
      `[webhook] No email_sends row for provider_message_id=${providerMessageId}`,
    );
    return jsonResponse(200, {
      ok: true,
      ignored: "unknown email_id",
    });
  }

  const occurredAt = body.created_at
    ? new Date(body.created_at)
    : new Date();
  const linkUrl = body.data?.click?.link ?? null;

  // Idempotency key: prefer Resend's own event id (stable across retries),
  // fall back to svix-id (unique per delivery, so retries deliver dupes —
  // not ideal but better than no dedup at all). The schema column is named
  // provider_event_id and represents Resend's identifier; this preserves
  // that semantic.
  const providerEventId = body.id ?? body.data?.id ?? verify.eventId;

  // Insert the event idempotently. If the unique index on provider_event_id
  // fires, we know we've seen this event already — no counter update needed.
  let inserted = false;
  await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      insert into email_events
        (email_send_id, event_type, occurred_at, provider_event_id, link_url, raw_payload)
      values
        (${send.id}, ${eventType}, ${occurredAt}, ${providerEventId}, ${linkUrl}, ${JSON.stringify(body)}::jsonb)
      on conflict (provider_event_id) where provider_event_id is not null
      do nothing
      returning id
    `);
    // pg's drizzle execute returns { rows, rowCount } — newly inserted rows
    // come back; on conflict we get rowCount=0.
    const rowCount =
      (result as { rowCount?: number; rows?: unknown[] }).rowCount ??
      ((result as { rows?: unknown[] }).rows?.length ?? 0);
    inserted = rowCount > 0;

    if (!inserted) return; // already counted, nothing else to do

    // Update counters + timestamps + status. We carry "first" timestamps
    // (only set if NULL) and bump counters atomically.
    if (eventType === "opened") {
      await tx
        .update(emailSends)
        .set({
          openCount: sql`${emailSends.openCount} + 1`,
          firstOpenedAt: sql`coalesce(${emailSends.firstOpenedAt}, ${occurredAt})`,
          lastEventAt: occurredAt,
          lastEventType: "opened",
          updatedAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    } else if (eventType === "clicked") {
      await tx
        .update(emailSends)
        .set({
          clickCount: sql`${emailSends.clickCount} + 1`,
          firstClickedAt: sql`coalesce(${emailSends.firstClickedAt}, ${occurredAt})`,
          lastEventAt: occurredAt,
          lastEventType: "clicked",
          updatedAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    } else if (eventType === "delivered") {
      await tx
        .update(emailSends)
        .set({
          status: "delivered",
          deliveredAt: sql`coalesce(${emailSends.deliveredAt}, ${occurredAt})`,
          lastEventAt: occurredAt,
          lastEventType: "delivered",
          updatedAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    } else if (eventType === "bounced") {
      await tx
        .update(emailSends)
        .set({
          status: "bounced",
          bouncedAt: sql`coalesce(${emailSends.bouncedAt}, ${occurredAt})`,
          lastEventAt: occurredAt,
          lastEventType: "bounced",
          updatedAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    } else if (eventType === "complained") {
      await tx
        .update(emailSends)
        .set({
          status: "complained",
          complainedAt: sql`coalesce(${emailSends.complainedAt}, ${occurredAt})`,
          lastEventAt: occurredAt,
          lastEventType: "complained",
          updatedAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    } else if (eventType === "failed") {
      await tx
        .update(emailSends)
        .set({
          status: "failed",
          lastEventAt: occurredAt,
          lastEventType: "failed",
          updatedAt: new Date(),
        })
        .where(eq(emailSends.id, send.id));
    }
  });

  return jsonResponse(200, {
    ok: true,
    eventType,
    inserted,
  });
}

// Touch the unused emailEvents import so editors don't strip it in re-saves;
// it's referenced inside the raw SQL above which the linter can't see.
void emailEvents;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

// Reject GETs with a clear message — saves debugging time when someone
// pastes the webhook URL into a browser to "test" it.
export async function GET() {
  return jsonResponse(405, {
    ok: false,
    error: "Use POST. This endpoint receives Resend webhooks.",
  });
}
