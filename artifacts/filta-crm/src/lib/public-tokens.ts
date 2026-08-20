// Public token generator + verifier for the customer-facing quote and
// agreement viewers (/q/[token], /a/[token]).
//
// Design:
//   - Tokens are 32-byte URL-safe random strings (256 bits of entropy).
//     Brute force is computationally infeasible — the partial-unique
//     index on the hash column gives us O(1) lookup so an attacker can't
//     guess + retry meaningfully.
//   - Only the sha256 hash is stored. The raw token only exists in the
//     customer's email body (and whatever clipboard/router state lives
//     between us and the recipient). DB compromise doesn't leak tokens.
//   - Constant-time comparison via crypto.timingSafeEqual avoids the
//     "compare hash byte-by-byte and short-circuit on mismatch" timing
//     side-channel. Probably overkill given the entropy budget but it's
//     ~free to do.
//   - Default expiry 60 days. Can be overridden per-call when we want a
//     shorter window (e.g. agreements that should expire faster than
//     proposals).
//
// Usage:
//   const { token, hash, expiresAt } = generatePublicToken();
//   await db.update(quoteVersions).set({
//     publicTokenHash: hash,
//     publicTokenExpiresAt: expiresAt,
//   }).where(eq(quoteVersions.id, id));
//   // include `token` in the customer's email; never log it server-side.
//
//   // On the public route:
//   const quote = await loadQuoteByToken(token);
//   if (!quote) return notFound();   // expired or never existed

import crypto from "node:crypto";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db, quoteVersions, serviceAgreements } from "@/db";

// 32 bytes of random data → 43 base64url characters. URL-safe means we
// don't have to URL-encode it when embedding in href= attributes.
const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_DAYS = 60;

export type GeneratedToken = {
  /** Raw token to embed in the email. NEVER log or persist. */
  token: string;
  /** sha256 hex digest. THIS is what goes in the DB. */
  hash: string;
  /** Pre-computed expiry timestamp. */
  expiresAt: Date;
};

/**
 * Generate a fresh public-link token. Returns the raw token (for the email
 * body) and its hash (for the DB column).
 */
export function generatePublicToken(
  opts: { expiryDays?: number } = {},
): GeneratedToken {
  const expiryDays = opts.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const buf = crypto.randomBytes(TOKEN_BYTES);
  const token = buf.toString("base64url");
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  return { token, hash, expiresAt };
}

/** sha256 hex digest of a token. Pure helper — no DB access. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time compare two hex digests. Hex strings of equal length are
 * coerced to Buffers; a length mismatch shortcircuits to false (in
 * non-constant time, but length is not a useful side channel here).
 */
export function tokenHashesEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ============================================================================
// LOADERS — used by the public viewer routes
// ============================================================================

/**
 * Load a quote_versions row by its public token. Returns null if no row
 * matches OR the token has expired. Uses the no-RLS db handle (public
 * routes have no session); the partial unique index on public_token_hash
 * means the lookup is O(1) and the WHERE clause filters expired rows.
 *
 * Note: we look up by hash directly rather than by id-then-compare so an
 * attacker who guesses a quote id can't probe whether a token exists.
 */
export async function loadQuoteByToken(rawToken: string) {
  if (!rawToken) return null;
  const hash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select()
    .from(quoteVersions)
    .where(
      and(
        eq(quoteVersions.publicTokenHash, hash),
        isNotNull(quoteVersions.publicTokenExpiresAt),
        gt(quoteVersions.publicTokenExpiresAt, now),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Same shape as loadQuoteByToken, for service_agreements. */
export async function loadAgreementByToken(rawToken: string) {
  if (!rawToken) return null;
  const hash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select()
    .from(serviceAgreements)
    .where(
      and(
        eq(serviceAgreements.publicTokenHash, hash),
        isNotNull(serviceAgreements.publicTokenExpiresAt),
        gt(serviceAgreements.publicTokenExpiresAt, now),
      ),
    )
    .limit(1);

  return row ?? null;
}

// ============================================================================
// REVOKE — used when a rep regenerates a quote or terminates an agreement
// ============================================================================

/**
 * Clear the token on a quote_version. Useful when the rep wants to send a
 * fresh link or invalidate an old one. Idempotent — calling on a row with
 * no token is a no-op.
 */
export async function revokeQuoteToken(quoteVersionId: string) {
  await db
    .update(quoteVersions)
    .set({
      publicTokenHash: null,
      publicTokenExpiresAt: null,
    })
    .where(eq(quoteVersions.id, quoteVersionId));
}

export async function revokeAgreementToken(agreementId: string) {
  await db
    .update(serviceAgreements)
    .set({
      publicTokenHash: null,
      publicTokenExpiresAt: null,
    })
    .where(eq(serviceAgreements.id, agreementId));
}


// ============================================================================
// URL HELPERS — for embedding in emails
// ============================================================================

function appBaseUrl(): string {
  // PUBLIC_APP_URL must be set to the deployed URL of the CRM, e.g.
  // "https://filta-crm.brett-telos.repl.co" or your custom domain. Used
  // exclusively for outbound emails — every other URL we render is
  // relative and inherits the request host.
  const url = process.env.PUBLIC_APP_URL;
  if (!url) {
    // In dev / Replit preview without the env var set, fall back to a
    // localhost URL so the emails are at least visually correct. The
    // actual link will be broken until PUBLIC_APP_URL is configured.
    return "http://localhost:3000";
  }
  return url.replace(/\/+$/, "");
}

/** Composes the customer-facing quote viewer URL. */
export function publicQuoteUrl(token: string): string {
  return `${appBaseUrl()}/q/${encodeURIComponent(token)}`;
}

/** Composes the customer-facing agreement signer URL. */
export function publicAgreementUrl(token: string): string {
  return `${appBaseUrl()}/a/${encodeURIComponent(token)}`;
}
