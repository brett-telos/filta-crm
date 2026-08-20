// Bearer token auth middleware.
// Reads the Authorization: Bearer <token> header, verifies the JWT, and
// attaches the decoded claims to req.session for downstream route handlers.

import type { Request, Response, NextFunction } from "express";
import { verifyToken, type SessionClaims } from "../lib/auth";

// Augment Express's Request type to carry session claims.
declare global {
  namespace Express {
    interface Request {
      session?: SessionClaims;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  let claims: SessionClaims | null = null;
  try {
    claims = await verifyToken(token);
  } catch (err) {
    req.log.warn({ err }, "JWT verification error");
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  if (!claims) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.session = claims;
  next();
}
