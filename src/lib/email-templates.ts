// Email rendering helpers.
//
// Two concerns live here:
//
// 1. Variable substitution — takes a template string with `{{placeholders}}`
//    and a vars map, returns the rendered string. Deliberately dumb: no
//    conditionals, no loops. If we ever need real templating we'll swap to
//    Handlebars or React Email, but for v1 (subject + 1-page cross-sell body)
//    a flat substitute is plenty and keeps the attack surface tiny.
//
// 2. Branded base HTML shell — wraps body content in a Filta-branded header
//    (logo + territory name in filta-blue) and footer (sender address +
//    unsubscribe stub). Uses inline styles because email clients strip
//    <style> blocks aggressively. The palette here mirrors the web app's
//    Tailwind tokens (filta-blue #0066CC, filta-blue-dark #004A99, etc.) but
//    hardcoded so we don't couple email output to the CSS bundle.
//
// 3. senderIdentityFor(territory) — returns the correct from address + name
//    per territory. fun_coast sends from sales@filtafuncoast.com, space_coast
//    from sales@filtaspacecoast.com. "both" and "unassigned" fall back to
//    filtafuncoast.com since that's the larger book today. These domains are
//    placeholders pending Brett's final domain decision — swap once he
//    confirms.

export type Territory = "fun_coast" | "space_coast" | "both" | "unassigned";

export type SenderIdentity = {
  fromEmail: string;
  fromName: string;
  /**
   * Display-friendly territory label used in the email footer and
   * elsewhere so we don't sprinkle "fun_coast → Fun Coast" conversion
   * across the codebase.
   */
  territoryLabel: string;
};

/**
 * Returns the outbound sender identity for a given territory.
 *
 * Defaults to Fun Coast when territory is "both" or unknown — the Fun Coast
 * book has more active FS cross-sell targets today, and we'd rather default
 * consistently than throw at the edge of an import or seed row.
 */
export function senderIdentityFor(
  territory: Territory | null | undefined,
): SenderIdentity {
  switch (territory) {
    case "space_coast":
      return {
        fromEmail: "sales@filtaspacecoast.com",
        fromName: "Filta Space Coast",
        territoryLabel: "Space Coast",
      };
    case "fun_coast":
    case "both":
    case "unassigned":
    default:
      return {
        fromEmail: "sales@filtafuncoast.com",
        fromName: "Filta Fun Coast",
        territoryLabel: "Fun Coast",
      };
  }
}

/**
 * Substitutes `{{key}}` placeholders in `template` with values from `vars`.
 *
 * - Trims whitespace inside the braces so `{{ firstName }}` and `{{firstName}}`
 *   both resolve.
 * - Missing/undefined/null values render as an empty string — we intentionally
 *   DO NOT throw or leave `{{firstName}}` visible in the final email. Callers
 *   that require a value should validate before calling.
 * - Values are coerced to string. No HTML escaping is applied, so callers
 *   passing user-controlled input into the HTML template should pre-escape.
 *   (All v1 placeholders are operator-typed or pulled from validated DB
 *   columns, so this is a pragmatic tradeoff.)
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const val = vars[key];
    if (val === undefined || val === null) return "";
    return String(val);
  });
}

/**
 * Scans a template for `{{placeholders}}` and returns the unique set of keys.
 * Useful for template editors / validation — "this template expects
 * firstName, companyName, senderName."
 */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

// ---------- Branded HTML shell ----------

const FILTA_BLUE = "#0066CC";
const FILTA_BLUE_DARK = "#004A99";
const SLATE_900 = "#0F172A";
const SLATE_600 = "#475569";
const SLATE_200 = "#E2E8F0";
const SLATE_50 = "#F8FAFC";

export type BaseHtmlOptions = {
  /** Territory of the sending account (drives footer display name). */
  territory: Territory | null | undefined;
  /** Main body HTML — will be dropped into a single-column card. */
  contentHtml: string;
  /** Optional preheader text — hidden preview in mail clients. */
  preheader?: string;
};

/**
 * Wraps the given HTML body in a Filta-branded header/footer shell suitable
 * for transactional email clients. Inline styles only.
 *
 * Rendering target: major web clients (Gmail, Outlook.com, Apple Mail) on
 * desktop + mobile. We use a 600px-wide single column — the boring-but-safe
 * default — and avoid background images since many clients strip them.
 */
export function wrapInBaseHtml(opts: BaseHtmlOptions): string {
  const sender = senderIdentityFor(opts.territory);
  const preheader = opts.preheader ?? "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(sender.fromName)}</title>
  </head>
  <body style="margin:0;padding:0;background:${SLATE_50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${SLATE_900};">
    <!-- Preheader: hidden but shown in inbox preview pane. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SLATE_50};">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${SLATE_200};border-radius:8px;overflow:hidden;">

            <!-- Header bar -->
            <tr>
              <td style="background:${FILTA_BLUE};padding:20px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="left" style="color:#ffffff;font-weight:600;font-size:18px;letter-spacing:0.2px;">
                      ${escapeHtml(sender.fromName)}
                    </td>
                    <td align="right" style="color:#cfe3ff;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
                      Filta Franchise
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px;font-size:15px;line-height:1.55;color:${SLATE_900};">
                ${opts.contentHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:${SLATE_50};border-top:1px solid ${SLATE_200};padding:18px 28px;font-size:12px;color:${SLATE_600};">
                <div>
                  <strong style="color:${FILTA_BLUE_DARK};">${escapeHtml(sender.fromName)}</strong>
                  &nbsp;&middot;&nbsp;
                  <a href="mailto:${sender.fromEmail}" style="color:${FILTA_BLUE};text-decoration:none;">${sender.fromEmail}</a>
                </div>
                <div style="margin-top:6px;color:${SLATE_600};">
                  You're receiving this because we've partnered with your kitchen, or we'd like to.
                  Reply "unsubscribe" and we'll take you off the list.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Minimal HTML escape for text that we interpolate into the shell (sender
 * name, preheader). NOT applied to contentHtml — that's expected to already
 * be HTML.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
