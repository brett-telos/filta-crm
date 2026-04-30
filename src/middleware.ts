// Route protection. Runs on the edge, so we use jose (edge-safe) to verify
// the JWT and gate everything except the auth routes + static assets. If the
// token is missing or invalid we redirect to /login with `?from=...` so the
// login action can bounce the user back where they were headed.
//
// bcryptjs does NOT run on the edge, so all password work stays in server
// actions / route handlers. Middleware only ever *reads* the JWT.

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "./lib/auth-constants";

// Paths that don't require auth. Keep this list tight.
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  // Static + framework assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return true;
  }
  return false;
}

function getSecret(): Uint8Array {
  const raw = process.env.NEXTAUTH_SECRET ?? process.env.SESSION_SECRET;
  if (!raw) {
    // In middleware we can't throw at boot; log and force unauth.
    return new TextEncoder().encode("___missing_secret___");
  }
  return new TextEncoder().encode(raw);
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return redirectToLogin(req, pathname + search);
  }

  try {
    await jwtVerify(token, getSecret());
    return NextResponse.next();
  } catch {
    // Expired or tampered — clear the cookie and send them to /login
    const res = redirectToLogin(req, pathname + search);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
}

function redirectToLogin(req: NextRequest, from: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?from=${encodeURIComponent(from)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Match everything; the isPublicPath helper handles allowlisting. Skipping
  // /_next and /favicon via matcher would be redundant because Next already
  // handles static file short-circuiting — but leaving matcher:all here gives
  // us one source of truth in PUBLIC_PATHS.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
