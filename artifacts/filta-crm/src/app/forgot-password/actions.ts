"use server";

// Forgot-password flow. We deliberately return the same "if the email exists,
// a link has been generated" response regardless of whether the account exists
// so we don't enumerate users. In this internal MVP we DO log the reset URL
// to the server console — there's no email provider wired up yet and Brett is
// the only user. When SES/Resend lands, swap the console.log for a send call.

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, users, passwordResetTokens } from "@/db";
import { generateResetToken } from "@/lib/auth";
import { headers } from "next/headers";

const Input = z.object({
  email: z.string().email().max(256),
});

export type ForgotState = {
  submitted?: boolean;
  error?: string;
};

const RESET_TTL_MINUTES = 30;

export async function forgotPasswordAction(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const parsed = Input.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: "Please enter a valid email." };
  }

  const email = parsed.data.email.toLowerCase().trim();

  const [user] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user && user.active) {
    const { raw, hash } = generateResetToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
    });

    const origin = resolveOrigin();
    const link = `${origin}/reset-password/${raw}`;

    // TODO: replace with email send. For now, log to server so Brett can grab
    // it from Replit console.
    // eslint-disable-next-line no-console
    console.log(
      `[filta-crm] password reset link for ${email} (expires ${expiresAt.toISOString()}): ${link}`,
    );
  }

  // Always return the same shape.
  return { submitted: true };
}

function resolveOrigin(): string {
  // Prefer the explicit env, fall back to the request origin.
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, "");
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
