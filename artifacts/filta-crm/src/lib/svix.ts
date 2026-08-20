// Svix webhook signature verification — Resend uses Svix to deliver
// webhooks, so verifying their signature is the standard Svix protocol:
//
//   sig_input = `${svix-id}.${svix-timestamp}.${rawBody}`
//   expected  = base64( hmac-sha256( sig_input, secret ) )
//   provided  = parse "v1,<base64sig>" from svix-signature header
//
// Plus a 5-minute timestamp tolerance to mitigate replays.
//
// We implement this manually with node:crypto rather than pulling in the
// `svix` npm package because:
//  - one fewer dep
//  - the algorithm is small enough to read at a glance
//  - keeps the verifier easy to swap if Resend changes providers later
//
// The webhook secret comes from the Resend dashboard and starts with
// `whsec_<base64-encoded-key>`. We strip the prefix and base64-decode to
// get the raw HMAC key.

import crypto from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult =
  | { ok: true; eventId: string; timestamp: number }
  | { ok: false; reason: string };

/**
 * Verify a Svix-signed webhook payload.
 *
 * @param rawBody  The raw request body as a string. MUST be the unparsed
 *                 bytes — JSON.stringify(parsedBody) won't match because of
 *                 whitespace differences.
 * @param headers  The request headers (case-insensitive lookup is on the
 *                 caller; pass already-lowered keys).
 * @param secret   The full webhook secret as configured in Resend, including
 *                 the `whsec_` prefix.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
): VerifyResult {
  const id = headers["svix-id"];
  const timestampHeader = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];

  if (!id) return { ok: false, reason: "Missing svix-id header" };
  if (!timestampHeader) {
    return { ok: false, reason: "Missing svix-timestamp header" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "Missing svix-signature header" };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "Invalid svix-timestamp" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "Timestamp outside tolerance window" };
  }

  // Extract the raw HMAC key. Secret format: 'whsec_<base64>'. Older Svix
  // configs may also accept 'whsec_<base64>' without prefix; handle both.
  const keyBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(keyBase64, "base64");
  } catch {
    return { ok: false, reason: "Invalid webhook secret encoding" };
  }
  if (keyBytes.length === 0) {
    return { ok: false, reason: "Empty webhook secret after decode" };
  }

  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", keyBytes)
    .update(signedPayload, "utf8")
    .digest("base64");

  // svix-signature can contain multiple space-separated 'v1,<sig>' pairs
  // when the secret is in rotation. Match if ANY of them line up.
  const provided = signatureHeader.split(" ");
  const matched = provided.some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    return safeEquals(sig, expected);
  });

  if (!matched) return { ok: false, reason: "Signature mismatch" };

  return { ok: true, eventId: id, timestamp };
}

// Constant-time string comparison. Buffer.byteLength must match for
// timingSafeEqual; if not, we still return false but in non-constant time
// (which is acceptable since "wrong length" leaks no useful info).
function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
