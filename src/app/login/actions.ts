"use server";

// Login server action. Does the bcrypt compare (node runtime, NOT edge),
// signs a JWT with the user's role + territory, sets the httpOnly cookie,
// bumps last_login_at, and bounces the user back to `?from=` if it was
// present on the form (the middleware passes it through).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@/db";
import {
  SESSION_COOKIE,
  signSession,
  verifyPassword,
  sessionCookieOptions,
} from "@/lib/auth";

const LoginInput = z.object({
  email: z.string().email().max(256),
  password: z.string().min(1).max(256),
  from: z.string().optional(),
});

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    from: formData.get("from"),
  });

  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }

  const { email, password, from } = parsed.data;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  // Constant-ish response on unknown email + bad password so we don't leak
  // which accounts exist. verifyPassword against a dummy hash burns similar
  // CPU to a real mismatch.
  if (!user || !user.active) {
    // Run a dummy compare to keep timing close.
    await verifyPassword(
      password,
      "$2a$12$CwTycUXWue0Thq9StjUM0uJ8C6JYcH6V7ydqfDcD.m7WiVY9iT6vu",
    );
    return { error: "Invalid email or password." };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return { error: "Invalid email or password." };
  }

  const token = await signSession({
    sub: user.id,
    email: user.email,
    role: user.role,
    territory: user.territory,
  });

  cookies().set(SESSION_COOKIE, token, sessionCookieOptions());

  // Fire-and-forget update of last_login_at
  await db
    .update(users)
    .set({ lastLoginAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(users.id, user.id));

  const dest = safeReturnTo(from);
  redirect(dest);
}

function safeReturnTo(from: string | undefined): string {
  if (!from) return "/";
  // Only allow same-origin relative paths; reject anything with scheme,
  // protocol-relative, or backslash tricks.
  if (!from.startsWith("/")) return "/";
  if (from.startsWith("//") || from.startsWith("/\\")) return "/";
  if (from.startsWith("/login") || from.startsWith("/forgot-password")) return "/";
  return from;
}
