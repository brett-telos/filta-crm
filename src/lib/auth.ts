// Lightweight auth: JWT session cookie + bcryptjs password hashing.
// Chose this over next-auth to keep the dep graph small and the token
// payload fully in our control (we carry user_id + role + territory for
// RLS session var injection).

import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

export const SESSION_COOKIE = "filta_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): Uint8Array {
  const raw = process.env.NEXTAUTH_SECRET ?? process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error(
      "NEXTAUTH_SECRET (or SESSION_SECRET) must be set in the environment.",
    );
  }
  return new TextEncoder().encode(raw);
}

export type SessionClaims = {
  sub: string; // user id
  email: string;
  role: "admin" | "sales_rep" | "technician";
  territory: "fun_coast" | "space_coast" | "both";
};

export async function signSession(claims: SessionClaims): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || typeof payload.sub !== "string") return null;
    return payload as unknown as SessionClaims;
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// Reset-token helpers — we store sha256(token), give the user the raw token.
export function generateResetToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
