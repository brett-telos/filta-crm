// Thin wrapper around Resend's REST API (https://resend.com/docs/api-reference/emails/send-email).
//
// We talk to Resend over fetch instead of pulling in the `resend` npm package:
//  - one fewer dep to ship to Replit
//  - no edge-vs-node runtime surprises
//  - easier to mock in tests (just stub global fetch)
//
// Env:
//   RESEND_API_KEY — required in prod. If missing, we fall back to a dev stub
//                    that logs the would-be payload and returns a synthetic
//                    provider message id so the rest of the send-and-log flow
//                    still works end-to-end on a fresh checkout.
//
// The wrapper ALWAYS resolves — never throws — so callers can store the error
// string on the email_sends row and surface it in the UI without try/catch
// noise around every call site.
//
// Usage:
//   const result = await sendEmail({
//     from: "sales@filtafuncoast.com",
//     fromName: "Filta Fun Coast",
//     to: "chef@example.com",
//     subject: "Keeping your hood grease-free",
//     html: "<p>...</p>",
//     text: "...",
//   });
//   if (result.ok) { /* persist result.providerMessageId */ }
//   else           { /* persist result.error */ }
//
// Known limitations:
//   - No batch API support yet — we only send one at a time. The cross-sell
//     dashboard issues sends sequentially; at current volume (90 accounts,
//     tens of sends per week) that's fine.
//   - No attachments. FS cross-sell is pure copy + optional inline image
//     referenced by URL in the base template.

export type SendEmailInput = {
  from: string; // address only, e.g. "sales@filtafuncoast.com"
  fromName?: string; // friendly display name, e.g. "Filta Fun Coast"
  to: string; // single recipient — keep it simple for v1
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  // Tags let us filter/search in the Resend dashboard later (e.g. by campaign).
  tags?: Array<{ name: string; value: string }>;
  // Attachments (W5.1 — quote PDFs). Resend expects each attachment as
  // { filename, content } where content is base64-encoded bytes. We don't
  // surface a Buffer in the type so the wrapper stays usable from edge
  // contexts later if we ever move it.
  attachments?: Array<{ filename: string; content: string }>;
};

export type SendEmailResult =
  | { ok: true; providerMessageId: string; devStub?: boolean }
  | { ok: false; error: string };

// Format "From" header per Resend spec: either "email@domain" or
// `"Display Name" <email@domain>`. Display names with special chars are
// quoted to be safe.
function formatFromHeader(from: string, fromName?: string): string {
  if (!fromName) return from;
  // Resend is tolerant of unquoted names but quoting is the safe default
  // (avoids issues when the friendly name has commas like "Filta, Inc.").
  const safeName = fromName.replace(/"/g, "'");
  return `"${safeName}" <${from}>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  // Dev stub: no key configured → log + return a fake id. We still return
  // ok:true so the caller's transaction commits and you can iterate on the
  // UI locally without setting up a Resend account.
  if (!apiKey) {
    const fakeId = `dev_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    console.log(
      `[resend:dev] RESEND_API_KEY missing — skipping real send. id=${fakeId}`,
      {
        from: formatFromHeader(input.from, input.fromName),
        to: input.to,
        subject: input.subject,
      },
    );
    return { ok: true, providerMessageId: fakeId, devStub: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: formatFromHeader(input.from, input.fromName),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
        tags: input.tags,
        attachments: input.attachments,
      }),
    });

    if (!res.ok) {
      // Resend returns a JSON error body { message, name } on failure. If the
      // body isn't JSON (e.g. 502 HTML page), fall back to status text.
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        if (body?.message) detail = `${body.name ?? "error"}: ${body.message}`;
      } catch {
        // leave detail as status text
      }
      return { ok: false, error: detail };
    }

    const body = (await res.json()) as { id?: string };
    if (!body.id) {
      return { ok: false, error: "resend: missing id in response body" };
    }
    return { ok: true, providerMessageId: body.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `resend: ${msg}` };
  }
}
