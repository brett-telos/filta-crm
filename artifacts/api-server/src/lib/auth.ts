// JWT auth helpers for the api-server.
// Mirrors the logic in artifacts/filta-crm/src/lib/auth.ts but as plain
// module-level helpers (no Next.js cookie wrappers needed here — we issue
// Bearer tokens for the mobile client).

import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function getJwtSecret(): Uint8Array {
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
  firstName: string;
  role: "admin" | "sales_rep" | "technician";
  territory: "fun_coast" | "space_coast" | "both";
};

export async function signToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    email: claims.email,
    firstName: claims.firstName,
    role: claims.role,
    territory: claims.territory,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload.sub || typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email as string,
      firstName: payload.firstName as string,
      role: payload.role as SessionClaims["role"],
      territory: payload.territory as SessionClaims["territory"],
    };
  } catch {
    return null;
  }
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
