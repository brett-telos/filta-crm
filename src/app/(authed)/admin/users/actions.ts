"use server";

// Admin user-management actions — admin-only.
//
// Three flows:
//   inviteUserAction         — create a new user with an unguessable
//                              password hash and email them a set-password
//                              link via the password_reset_tokens table.
//                              Re-inviting the same email rotates the
//                              token instead of erroring (idempotent).
//   updateUserAction         — change role / territory / active flag on
//                              an existing user. Self-protection: an
//                              admin can't demote or deactivate themselves.
//   resendInviteAction       — generate a fresh reset token + resend the
//                              invite email (for users who lost the
//                              original link).
//
// All RLS-bypass via the no-RLS db handle is fine here because:
//   1. We hard-gate at the action layer on session.role === 'admin'
//   2. The users table doesn't have territory-scoped RLS anyway (it's
//      a global resource)

import crypto from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  users,
  passwordResetTokens,
  messageTemplates,
} from "@/db";
import { requireSession } from "@/lib/session";
import { generateResetToken, hashPassword } from "@/lib/auth";
import { sendEmail } from "@/lib/resend";
import {
  renderTemplate,
  senderIdentityFor,
  wrapInBaseHtml,
} from "@/lib/email-templates";

const RESET_TTL_MINUTES = 60 * 24 * 7; // 7 days for invites — longer than
                                       // the 30-min self-serve reset window
                                       // because new hires might not check
                                       // email immediately.

function requireAdmin(role: string): string | null {
  if (role !== "admin") return "Admin role required";
  return null;
}

function resolveOrigin(): string {
  if (process.env.PUBLIC_APP_URL) {
    return process.env.PUBLIC_APP_URL.replace(/\/+$/, "");
  }
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL.replace(/\/+$/, "");
  }
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

// ============================================================================
// INVITE
// ============================================================================

const InviteInput = z.object({
  email: z.string().email().max(256),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.enum(["admin", "sales_rep", "technician"]),
  territory: z.enum(["fun_coast", "space_coast", "both"]),
});

export type InviteResult = {
  ok: boolean;
  error?: string;
  userId?: string;
  /** Surfaced for testing in dev — not shown to the user. */
  resetLinkForDev?: string;
};

export async function inviteUserAction(
  input: z.infer<typeof InviteInput>,
): Promise<InviteResult> {
  const session = await requireSession();
  const adminErr = requireAdmin(session.role);
  if (adminErr) return { ok: false, error: adminErr };

  const parsed = InviteInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "Invalid input",
    };
  }
  const { email, firstName, lastName, role, territory } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  // Look up by email — re-invite is supported.
  const [existing] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  let userId: string;

  if (existing) {
    // Re-invite path: re-activate if needed, update name/role/territory if
    // the admin changed them, generate a fresh reset token, send.
    await db
      .update(users)
      .set({
        firstName,
        lastName,
        role,
        territory,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    // Net-new user. The password_hash column is NOT NULL but we don't
    // want a usable password — the user will set one via the reset link.
    // Generate 32 random bytes, hex-encode (so it's a valid string), and
    // hash that. No one knows the plaintext, including us.
    const placeholderPlain = crypto.randomBytes(32).toString("hex");
    const placeholderHash = await hashPassword(placeholderPlain);
    const [inserted] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash: placeholderHash,
        firstName,
        lastName,
        role,
        territory,
        active: true,
      })
      .returning({ id: users.id });
    userId = inserted.id;
  }

  // Generate the password reset token (which doubles as the invite token).
  const { raw, hash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hash,
    expiresAt,
  });

  const origin = resolveOrigin();
  const setPasswordLink = `${origin}/reset-password/${raw}`;

  // Pull the invite template (falls back to a hardcoded copy if the seed
  // hasn't been run yet — keeps the action usable on a fresh checkout).
  const [tpl] = await db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.key, "user_invite_v1"),
        eq(messageTemplates.active, true),
      ),
    )
    .limit(1);

  const sender = senderIdentityFor(territory === "space_coast" ? "space_coast" : "fun_coast");
  const vars = {
    firstName,
    senderFirstName:
      // The inviter's first name from the session; falls back to the
      // territory-derived name if missing.
      session.email.split("@")[0] || sender.fromName,
    territoryLabel:
      territory === "both"
        ? "Filta CRM"
        : `Filta ${territory === "space_coast" ? "Space Coast" : "Fun Coast"}`,
    customerLink: setPasswordLink,
    expiresInDays: String(Math.round(RESET_TTL_MINUTES / (60 * 24))),
  };

  const subjectTemplate =
    tpl?.subjectTemplate ?? "Set your password to access the Filta CRM";
  const htmlTemplate =
    tpl?.bodyHtmlTemplate ??
    `<p>Hi {{firstName}},</p>
<p>You've been invited to the Filta CRM. Click below to set your password:</p>
<p><a href="{{customerLink}}">{{customerLink}}</a></p>
<p>The link is valid for {{expiresInDays}} days.</p>`;
  const textTemplate =
    tpl?.bodyTextTemplate ??
    `Hi {{firstName}},

You've been invited to the Filta CRM. Set your password here:
{{customerLink}}

The link is valid for {{expiresInDays}} days.`;

  const renderedSubject = renderTemplate(subjectTemplate, vars);
  const renderedHtmlFragment = renderTemplate(htmlTemplate, vars);
  const renderedText = renderTemplate(textTemplate, vars);
  const renderedHtml = wrapInBaseHtml({
    territory: territory === "both" ? "fun_coast" : territory,
    contentHtml: renderedHtmlFragment,
    preheader: "You've been invited to the Filta CRM. Set your password to log in.",
  });

  const sendResult = await sendEmail({
    from: sender.fromEmail,
    fromName: sender.fromName,
    to: normalizedEmail,
    subject: renderedSubject,
    html: renderedHtml,
    text: renderedText,
    replyTo: process.env.EMAIL_REPLY_TO || sender.fromEmail,
    tags: [{ name: "campaign", value: "user_invite" }],
  });

  // We don't fail the invite if email send failed — the user row is
  // created, the token is valid, and the admin can resend or share the
  // link directly. Surface the failure in the result for the UI to show.
  if (!sendResult.ok) {
    revalidatePath("/admin/users");
    return {
      ok: true,
      userId,
      error: `User created but invite email failed: ${sendResult.error}. Use 'Resend invite' or share the link manually.`,
      // In dev (no RESEND_API_KEY), expose the link so the admin can copy/paste.
      resetLinkForDev: setPasswordLink,
    };
  }

  revalidatePath("/admin/users");
  return {
    ok: true,
    userId,
    resetLinkForDev: sendResult.devStub ? setPasswordLink : undefined,
  };
}

// ============================================================================
// UPDATE (role / territory / active)
// ============================================================================

const UpdateInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "sales_rep", "technician"]).optional(),
  territory: z.enum(["fun_coast", "space_coast", "both"]).optional(),
  active: z.boolean().optional(),
});

export type UpdateUserResult = { ok: boolean; error?: string };

export async function updateUserAction(
  input: z.infer<typeof UpdateInput>,
): Promise<UpdateUserResult> {
  const session = await requireSession();
  const adminErr = requireAdmin(session.role);
  if (adminErr) return { ok: false, error: adminErr };

  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "Invalid input",
    };
  }
  const { userId, role, territory, active } = parsed.data;

  // Self-protection: don't let an admin demote or deactivate themselves
  // (they could lock themselves out of the system).
  if (userId === session.sub) {
    if (role && role !== "admin") {
      return {
        ok: false,
        error: "You can't demote yourself out of admin. Have another admin do it.",
      };
    }
    if (active === false) {
      return {
        ok: false,
        error: "You can't deactivate your own account.",
      };
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (role !== undefined) updates.role = role;
  if (territory !== undefined) updates.territory = territory;
  if (active !== undefined) updates.active = active;

  if (Object.keys(updates).length === 1) {
    return { ok: false, error: "Nothing to update" };
  }

  const result = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (result.length === 0) return { ok: false, error: "User not found" };

  revalidatePath("/admin/users");
  return { ok: true };
}

// ============================================================================
// RESEND INVITE — generate a fresh reset token and re-email
// ============================================================================

const ResendInput = z.object({ userId: z.string().uuid() });

export type ResendInviteResult = {
  ok: boolean;
  error?: string;
  resetLinkForDev?: string;
};

export async function resendInviteAction(
  input: z.infer<typeof ResendInput>,
): Promise<ResendInviteResult> {
  const session = await requireSession();
  const adminErr = requireAdmin(session.role);
  if (adminErr) return { ok: false, error: adminErr };

  const parsed = ResendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      role: users.role,
      territory: users.territory,
    })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);
  if (!user) return { ok: false, error: "User not found" };

  // Mint a fresh token + expiry. We don't bother revoking older tokens
  // because they expire on their own and a fresh row beats them in the
  // "most recent valid" lookup.
  const { raw, hash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hash,
    expiresAt,
  });

  const origin = resolveOrigin();
  const link = `${origin}/reset-password/${raw}`;

  // Reuse invite template
  const [tpl] = await db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.key, "user_invite_v1"),
        eq(messageTemplates.active, true),
      ),
    )
    .limit(1);
  const sender = senderIdentityFor(
    user.territory === "space_coast" ? "space_coast" : "fun_coast",
  );
  const vars = {
    firstName: user.firstName,
    senderFirstName: session.email.split("@")[0] || sender.fromName,
    territoryLabel: "Filta CRM",
    customerLink: link,
    expiresInDays: String(Math.round(RESET_TTL_MINUTES / (60 * 24))),
  };
  const subjectTpl = tpl?.subjectTemplate ?? "Your Filta CRM password set link";
  const htmlTpl =
    tpl?.bodyHtmlTemplate ??
    `<p>Hi {{firstName}},</p><p><a href="{{customerLink}}">Set your password</a></p>`;
  const textTpl =
    tpl?.bodyTextTemplate ?? `Hi {{firstName}}, set your password: {{customerLink}}`;

  const sendResult = await sendEmail({
    from: sender.fromEmail,
    fromName: sender.fromName,
    to: user.email,
    subject: renderTemplate(subjectTpl, vars),
    html: wrapInBaseHtml({
      territory: user.territory === "space_coast" ? "space_coast" : "fun_coast",
      contentHtml: renderTemplate(htmlTpl, vars),
      preheader: "Fresh password set link",
    }),
    text: renderTemplate(textTpl, vars),
    replyTo: process.env.EMAIL_REPLY_TO || sender.fromEmail,
    tags: [{ name: "campaign", value: "user_invite_resend" }],
  });

  revalidatePath("/admin/users");

  if (!sendResult.ok) {
    return {
      ok: false,
      error: sendResult.error,
      resetLinkForDev: link,
    };
  }
  return {
    ok: true,
    resetLinkForDev: sendResult.devStub ? link : undefined,
  };
}
