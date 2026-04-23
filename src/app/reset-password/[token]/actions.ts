"use server";

// Reset-password flow (second half). Validates the raw token against the
// stored sha256 hash, checks expiry + used_at, updates the user's password,
// marks the token consumed, and redirects to /login?reset=1. On any validation
// failure we return a generic error so we can't be used as an oracle for
// which tokens are real.

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, users, passwordResetTokens } from "@/db";
import { hashPassword, hashResetToken } from "@/lib/auth";
import { redirect } from "next/navigation";

const Input = z.object({
  token: z.string().min(10).max(512),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(256),
  confirm: z.string().min(1),
});

export type ResetState = {
  error?: string;
};

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = Input.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "Passwords don't match." };
  }

  const tokenHash = hashResetToken(parsed.data.token);

  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  if (!row) {
    return { error: "That reset link is invalid or expired." };
  }

  const newHash = await hashPassword(parsed.data.password);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: sql`now()` })
      .where(eq(users.id, row.userId));

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(eq(passwordResetTokens.id, row.id));
  });

  redirect("/login?reset=1");
}

// Lightweight check used by the page to decide whether to render the form
// vs. a "link invalid/expired" screen. Does NOT consume the token.
export async function checkResetTokenAction(
  rawToken: string,
): Promise<{ valid: boolean }> {
  if (!rawToken || rawToken.length < 10 || rawToken.length > 512) {
    return { valid: false };
  }
  const tokenHash = hashResetToken(rawToken);
  const [row] = await db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return { valid: Boolean(row) };
}
