// POST /api/digests/run?type=daily|weekly
//
// Computes a digest and emails it to all admin users. Authed via the
// DIGEST_SECRET env var passed in the Authorization: Bearer header so
// any external scheduler (Replit Scheduled Deployments, cron-job.org,
// GitHub Actions) can trigger it. The admin manual-trigger button on
// the dashboard hits the same endpoint with a special "from-admin"
// session flag.
//
// Returns counts and per-recipient send result so the admin button can
// show "sent to 3 admins" feedback.
//
// Runtime: Node — needs db + PDF utilities (the latter aren't used
// here yet but kept consistent with the rest of /api).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users, emailSends } from "@/db";
import { sendEmail } from "@/lib/resend";
import { senderIdentityFor } from "@/lib/email-templates";
import {
  computeDailyDigest,
  computeWeeklyDigest,
} from "@/lib/digests";
import {
  renderDailyDigest,
  renderWeeklyDigest,
} from "@/lib/digest-templates";
import { requireSession, canAccessTerritory } from "@/lib/session";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<{
  ok: boolean;
  via: "secret" | "session";
  userId?: string;
  error?: string;
}> {
  // Path 1: external scheduler with DIGEST_SECRET in Authorization header.
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.DIGEST_SECRET;
  if (expected && auth.startsWith("Bearer ")) {
    const provided = auth.slice("Bearer ".length).trim();
    if (provided === expected) {
      return { ok: true, via: "secret" };
    }
  }

  // Path 2: admin user from a CRM session (the dashboard manual button).
  try {
    const session = await requireSession();
    if (session.role === "admin") {
      return { ok: true, via: "session", userId: session.sub };
    }
    return { ok: false, via: "session", error: "Admin role required" };
  } catch {
    // requireSession throws on missing session — that's fine, we just
    // fall through to "no auth" below.
  }

  return {
    ok: false,
    via: "secret",
    error:
      expected
        ? "Provide Authorization: Bearer <DIGEST_SECRET> or sign in as admin"
        : "DIGEST_SECRET not configured; can only be triggered by admin session",
  };
}

export async function POST(req: Request) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "daily";
  if (type !== "daily" && type !== "weekly") {
    return NextResponse.json(
      { ok: false, error: "type must be 'daily' or 'weekly'" },
      { status: 400 },
    );
  }

  // Compute the digest payload.
  const payload =
    type === "daily" ? await computeDailyDigest() : await computeWeeklyDigest();
  const rendered =
    type === "daily" ? renderDailyDigest(payload) : renderWeeklyDigest(payload);

  // Fetch all admin users to send to.
  const recipients = await db
    .select({ id: users.id, email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.role, "admin"));

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: true,
      type,
      sent: 0,
      counters: payload.counters,
      note: "No admin users to send to",
    });
  }

  // Send to each. We don't bcc — separate sends so each admin's reply
  // goes to the rep, not to a list. From address comes from a "system"
  // sender — we don't have an admin user's territory to derive from, so
  // default to Fun Coast.
  const sender = senderIdentityFor("both");
  const results: Array<{
    email: string;
    ok: boolean;
    error?: string;
    devStub?: boolean;
  }> = [];

  for (const r of recipients) {
    // Stamp an email_sends row even though there's no account_id (these
    // are internal emails). Skip the persistence here — internal digests
    // don't need to live on the customer-facing email_sends timeline.
    // We log results in the response body for the caller to inspect.
    const result = await sendEmail({
      from: sender.fromEmail,
      fromName: "Filta CRM",
      to: r.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.EMAIL_REPLY_TO || sender.fromEmail,
      tags: [
        { name: "campaign", value: `digest_${type}` },
        { name: "auth", value: auth.via },
      ],
    });
    if (result.ok) {
      results.push({ email: r.email, ok: true, devStub: result.devStub });
    } else {
      results.push({ email: r.email, ok: false, error: result.error });
    }
  }

  return NextResponse.json({
    ok: true,
    type,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    counters: payload.counters,
    results,
  });
}

// Touch unused imports so they're not pruned — referenced via the
// `auth` flow.
void emailSends;
void canAccessTerritory;
