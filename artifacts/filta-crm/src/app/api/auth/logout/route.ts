// POST /api/auth/logout — clear the session cookie and send the user to /login.
// We accept GET too so that a plain <a href> logout link works without JS.

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

function logout(req: Request) {
  const url = new URL(req.url);
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url);
  // The workspace proxy forwards the request to Next on its private port.
  // Keep the redirect relative so it returns through the public CRM path.
  res.headers.set("Location", "/login");
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export async function POST(req: Request) {
  return logout(req);
}

export async function GET(req: Request) {
  return logout(req);
}
