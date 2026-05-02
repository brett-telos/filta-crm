// Render a DigestPayload into { subject, html, text }. Two formats:
//   - Daily morning brief (terse, just yesterday's activity)
//   - Weekly Monday digest (adds MRR snapshot + accumulated context)
//
// Not stored in message_templates because the body shape depends on
// dynamic event lists (variable-length replies / quotes / agreements).
// The send-digest endpoint calls these renderers directly.
//
// Branding: filta-blue header, slate body. Mobile-friendly single-column
// layout with inline styles since email clients strip <style> blocks.

import { wrapInBaseHtml } from "@/lib/email-templates";
import type { DigestPayload } from "@/lib/digests";

const APP_URL = (process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

function fc(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ============================================================================
// DAILY
// ============================================================================

export function renderDailyDigest(payload: DigestPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const c = payload.counters;
  const headlineCount = c.repliesReceived + c.quotesAccepted + c.agreementsSigned;
  const subject = headlineCount > 0
    ? `Filta morning brief — ${headlineCount} new ${headlineCount === 1 ? "thing" : "things"} overnight`
    : "Filta morning brief — quiet overnight";

  const tilesHtml = tilesRow([
    { label: "Replies", value: c.repliesReceived, accent: c.repliesReceived > 0 ? "positive" : null },
    { label: "Quotes sent", value: c.quotesSent },
    { label: "Quotes accepted", value: c.quotesAccepted, accent: c.quotesAccepted > 0 ? "positive" : null },
    { label: "Agreements signed", value: c.agreementsSigned, accent: c.agreementsSigned > 0 ? "positive" : null },
    { label: "Overdue tasks", value: c.overdueTasks, accent: c.overdueTasks > 0 ? "warning" : null },
    { label: "At-risk customers", value: c.atRiskCustomers, accent: c.atRiskCustomers > 0 ? "warning" : null },
  ]);

  const sections = [
    eventList("Replies received", payload.events.replies, (r) => `${r.companyName} — "${r.subject}" (${fmtTime(r.occurredAt)})`),
    eventList("Quotes accepted", payload.events.quotesAcceptedList, (q) => `${q.companyName} — ${fc(q.annualValue)}/yr (${fmtTime(q.acceptedAt)})`),
    eventList("Agreements signed", payload.events.agreementsSignedList, (a) => `${a.companyName} — signed by ${a.signedName ?? "customer"} (${fmtTime(a.signedAt)})`),
    eventList("Quotes sent", payload.events.quotesSentList, (q) => `${q.companyName} — ${fc(q.annualValue)}/yr (${fmtTime(q.sentAt)})`),
  ].join("");

  const ctaRow = `
    <p style="text-align:center;margin:24px 0 0 0;">
      <a href="${APP_URL}/today" style="display:inline-block;background-color:#0066CC;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:4px;font-weight:bold;font-size:13px;margin-right:6px;">Open Today</a>
      <a href="${APP_URL}/at-risk" style="display:inline-block;background-color:#FFFFFF;color:#0066CC;border:1px solid #0066CC;text-decoration:none;padding:10px 20px;border-radius:4px;font-weight:bold;font-size:13px;">At-Risk queue</a>
    </p>
  `;

  const intro = headlineCount > 0
    ? `<p>Here's what came in overnight — ${headlineCount} thing${headlineCount === 1 ? "" : "s"} worth a look.</p>`
    : `<p>No new activity overnight. Nothing to chase first thing.</p>`;

  const closing = `<p style="font-size:12px;color:#94A3B8;margin-top:24px;">Numbers cover ${payload.range.label}. ${c.fsTargetsRemaining} FiltaClean cross-sell targets still in the pipeline.</p>`;

  const html = wrapInBaseHtml({
    territory: "both",
    contentHtml: `${intro}${tilesHtml}${sections}${ctaRow}${closing}`,
    preheader: subject,
  });

  const text = renderText("Filta morning brief", payload, {
    showMrr: false,
  });

  return { subject, html, text };
}

// ============================================================================
// WEEKLY
// ============================================================================

export function renderWeeklyDigest(payload: DigestPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const c = payload.counters;
  const mrr = payload.mrr;

  const subject = mrr
    ? `Filta weekly — ${fc(mrr.currentTotal)}/mo MRR (${mrr.deltaVsPriorPeriod >= 0 ? "+" : ""}${fc(mrr.deltaVsPriorPeriod)} this week)`
    : "Filta weekly digest";

  const mrrTile = mrr
    ? `
      <div style="background-color:#0066CC;color:#FFFFFF;padding:18px 20px;border-radius:8px;margin-bottom:16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,0.85);">Monthly recurring revenue</div>
        <div style="font-size:28px;font-weight:bold;margin-top:4px;">${fc(mrr.currentTotal)}/mo</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.9);margin-top:4px;">
          ${mrr.deltaVsPriorPeriod >= 0 ? "+" : ""}${fc(mrr.deltaVsPriorPeriod)} from accepted quotes this week ·
          FS attach rate ${mrr.fsAttachRate.toFixed(1)}%
        </div>
      </div>
    `
    : "";

  const tilesHtml = tilesRow([
    { label: "Quotes accepted", value: c.quotesAccepted, accent: c.quotesAccepted > 0 ? "positive" : null },
    { label: "Agreements signed", value: c.agreementsSigned, accent: c.agreementsSigned > 0 ? "positive" : null },
    { label: "Quotes sent", value: c.quotesSent },
    { label: "Replies received", value: c.repliesReceived },
    { label: "Overdue tasks", value: c.overdueTasks, accent: c.overdueTasks > 0 ? "warning" : null },
    { label: "At-risk customers", value: c.atRiskCustomers, accent: c.atRiskCustomers > 0 ? "warning" : null },
  ]);

  const sections = [
    eventList("Agreements signed this week", payload.events.agreementsSignedList, (a) => `${a.companyName} — signed by ${a.signedName ?? "customer"} (${fmtTime(a.signedAt)})`),
    eventList("Quotes accepted this week", payload.events.quotesAcceptedList, (q) => `${q.companyName} — ${fc(q.annualValue)}/yr (${fmtTime(q.acceptedAt)})`),
    eventList("Quotes sent this week", payload.events.quotesSentList, (q) => `${q.companyName} — ${fc(q.annualValue)}/yr`),
    eventList("Customer replies", payload.events.replies, (r) => `${r.companyName} — "${r.subject}"`),
  ].join("");

  const ctaRow = `
    <p style="text-align:center;margin:24px 0 0 0;">
      <a href="${APP_URL}/dashboard" style="display:inline-block;background-color:#0066CC;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:4px;font-weight:bold;font-size:13px;margin-right:6px;">Open Dashboard</a>
      <a href="${APP_URL}/cross-sell" style="display:inline-block;background-color:#FFFFFF;color:#0066CC;border:1px solid #0066CC;text-decoration:none;padding:10px 20px;border-radius:4px;font-weight:bold;font-size:13px;">Cross-sell list (${c.fsTargetsRemaining})</a>
    </p>
  `;

  const intro = `<p>Here's the week at a glance — ${c.quotesAccepted} quote${c.quotesAccepted === 1 ? "" : "s"} closed, ${c.agreementsSigned} agreement${c.agreementsSigned === 1 ? "" : "s"} signed.</p>`;

  const html = wrapInBaseHtml({
    territory: "both",
    contentHtml: `${intro}${mrrTile}${tilesHtml}${sections}${ctaRow}`,
    preheader: subject,
  });

  const text = renderText("Filta weekly digest", payload, { showMrr: true });

  return { subject, html, text };
}

// ============================================================================
// HTML helpers
// ============================================================================

function tilesRow(
  tiles: Array<{
    label: string;
    value: number;
    accent?: "positive" | "warning" | null;
  }>,
): string {
  // Tiles laid out in a table — most reliable cross-client. Two columns
  // on narrow screens (default), three on wide.
  const cells = tiles
    .map((t) => {
      const color =
        t.accent === "positive"
          ? "#047857"
          : t.accent === "warning"
            ? "#B45309"
            : "#0F172A";
      return `<td valign="top" align="center" style="padding:10px;width:33%;border:1px solid #E2E8F0;background-color:#F8FAFC;border-radius:6px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:#64748B;">${t.label}</div>
        <div style="font-size:22px;font-weight:bold;color:${color};margin-top:2px;">${t.value}</div>
      </td>`;
    })
    .join("");

  // 3-column grid
  return `<table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;border-collapse:separate;margin:16px 0;">
    <tr>${cells.slice(0, cells.length / 2)}</tr>
    <tr>${cells.slice(cells.length / 2)}</tr>
  </table>`;
}

function eventList<T>(
  title: string,
  items: T[],
  format: (item: T) => string,
): string {
  if (items.length === 0) return "";
  const lis = items
    .slice(0, 10)
    .map(
      (item) =>
        `<li style="margin:4px 0;font-size:13px;color:#334155;">${escapeHtml(format(item))}</li>`,
    )
    .join("");
  const more =
    items.length > 10
      ? `<li style="margin:4px 0;font-size:12px;color:#94A3B8;">…and ${items.length - 10} more</li>`
      : "";
  return `<div style="margin-top:14px;">
    <div style="font-size:11px;font-weight:bold;color:#64748B;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;">${escapeHtml(title)}</div>
    <ul style="margin:0;padding-left:18px;">${lis}${more}</ul>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// Plain-text fallback
// ============================================================================

function renderText(
  title: string,
  payload: DigestPayload,
  opts: { showMrr: boolean },
): string {
  const c = payload.counters;
  const lines: string[] = [];
  lines.push(title);
  lines.push("=".repeat(title.length));
  lines.push("");
  lines.push(`Range: ${payload.range.label}`);
  lines.push("");
  if (opts.showMrr && payload.mrr) {
    lines.push(`MRR: ${fc(payload.mrr.currentTotal)}/mo (${payload.mrr.deltaVsPriorPeriod >= 0 ? "+" : ""}${fc(payload.mrr.deltaVsPriorPeriod)} this week)`);
    lines.push(`FS attach rate: ${payload.mrr.fsAttachRate.toFixed(1)}%`);
    lines.push("");
  }
  lines.push(`Replies: ${c.repliesReceived} · Quotes sent: ${c.quotesSent} · Accepted: ${c.quotesAccepted} · Signed: ${c.agreementsSigned}`);
  lines.push(`Overdue tasks: ${c.overdueTasks} · At-risk customers: ${c.atRiskCustomers} · FS targets remaining: ${c.fsTargetsRemaining}`);
  lines.push("");
  if (payload.events.quotesAcceptedList.length > 0) {
    lines.push("Quotes accepted:");
    for (const q of payload.events.quotesAcceptedList.slice(0, 10)) {
      lines.push(`  - ${q.companyName} — ${fc(q.annualValue)}/yr`);
    }
    lines.push("");
  }
  if (payload.events.agreementsSignedList.length > 0) {
    lines.push("Agreements signed:");
    for (const a of payload.events.agreementsSignedList.slice(0, 10)) {
      lines.push(`  - ${a.companyName} — by ${a.signedName ?? "customer"}`);
    }
    lines.push("");
  }
  if (payload.events.replies.length > 0) {
    lines.push("Replies received:");
    for (const r of payload.events.replies.slice(0, 10)) {
      lines.push(`  - ${r.companyName} — "${r.subject}"`);
    }
    lines.push("");
  }
  lines.push(`Open: ${APP_URL || "(set PUBLIC_APP_URL)"}/dashboard`);
  return lines.join("\n");
}
