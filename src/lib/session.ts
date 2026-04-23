// Server-side session helpers. These read the JWT out of the httpOnly cookie
// set at login and return the decoded claims, or null. requireSession() is the
// one to use in server components / server actions / route handlers where an
// authenticated user is non-negotiable — it redirects to /login on miss so the
// caller can treat the return value as guaranteed present.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type SessionClaims } from "./auth";

export async function getSession(): Promise<SessionClaims | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(
  redirectTo: string = "/login",
): Promise<SessionClaims> {
  const session = await getSession();
  if (!session) {
    redirect(redirectTo);
  }
  return session;
}

export async function requireAdmin(): Promise<SessionClaims> {
  const session = await requireSession();
  if (session.role !== "admin") {
    redirect("/"); // soft redirect; no error page yet
  }
  return session;
}

// Territory guard — used for route-level scoping so a Fun Coast rep can't
// navigate to a Space Coast-only page via URL. Data-level scoping still
// happens in the queries + RLS.
export function canAccessTerritory(
  session: SessionClaims,
  territory: "fun_coast" | "space_coast",
): boolean {
  if (session.territory === "both") return true;
  return session.territory === territory;
}
