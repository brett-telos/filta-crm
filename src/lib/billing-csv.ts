// Parse a FiltaSymphony billing CSV and compute the diff against current
// accounts.service_profile state. Pure functions (no DB access) so the
// upload action can call this synchronously and stash the result on the
// billing_imports.diff_snapshot column for later apply.
//
// Mirrors the parsing logic in scripts/import_billing.ts but trimmed for
// the single-file monthly-update use case the admin UI targets:
//   - one CSV (one month) at a time
//   - emits a structured diff (insert / update / no-op) instead of writing
//     directly
//   - matches against existing accounts by normalized company name only
//     (no levenshtein loose-match — admin can manually re-link via the
//     accounts UI if a row didn't match)

import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";

// ============================================================================
// PARSE
// ============================================================================

export type CustomerTotals = {
  displayName: string;
  /** Average monthly revenue for FiltaFry, derived from the file. */
  ff: number;
  /** Average monthly revenue for FiltaClean. */
  fs: number;
  /** Average monthly revenue for FiltaBio. */
  fb: number;
  /** Average monthly revenue for FiltaGold. */
  fg: number;
  /** Average monthly revenue for FiltaCool. */
  fc: number;
  /** Average monthly revenue for FiltaDrain. */
  fd: number;
  /** Most recent service date observed in this file (ISO yyyy-mm-dd). */
  lastServiceDate: string | null;
};

const SERVICE_CODE_TO_KEY: Record<string, keyof Omit<CustomerTotals, "displayName" | "lastServiceDate">> = {
  FF: "ff",
  FS: "fs",
  FB: "fb",
  FG: "fg",
  FC: "fc",
  FD: "fd",
};

function parseAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = String(raw).replace(/[^0-9.\-]/g, "");
  const n = Number.parseFloat(m);
  return Number.isFinite(n) ? n : 0;
}

// "31 Supper Club: 03/10/2026 12:00am | Performed"
function parseCustomerHeader(
  cell: string,
): { customer: string; dateISO: string | null } | null {
  if (!cell || !cell.includes(":")) return null;
  // The customer name can contain colons in rare cases; split on the LAST
  // colon followed by a space + digit.
  const m = cell.match(/^(.+?):\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, name, mo, dy, yr] = m;
  const month = mo.padStart(2, "0");
  const day = dy.padStart(2, "0");
  return { customer: name.trim(), dateISO: `${yr}-${month}-${day}` };
}

export function normalizeCompany(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(LLC|INC|CORP|CO|COMPANY|LTD|LP|LLP|THE|OF)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a single billing CSV (the full text content, not a file path).
 * Returns one entry per customer block keyed by normalized company name.
 *
 * The CSV shape is non-standard: a heading band of 3 rows, then repeating
 * blocks of `customer header` + N service lines + a `Total` line. Each
 * service line is `<code>,<desc>,<qty>,<rate>,<amount>`.
 *
 * NOTE: The bulk script averages totals across MULTIPLE monthly files
 * (typically 3) to smooth seasonality. The admin upload is single-file —
 * we do NOT divide by 3 here. Each call processes one month's data.
 */
export function parseBillingCsvText(text: string): Map<string, CustomerTotals> {
  const rows = parse(text, {
    columns: false,
    skip_empty_lines: false,
    bom: true,
    relax_column_count: true,
  }) as string[][];

  const totals = new Map<string, CustomerTotals>();
  let current: { key: string; totals: CustomerTotals } | null = null;

  for (const row of rows) {
    const first = (row[0] ?? "").trim();
    if (!first) {
      // blank row — flush current customer if needed but keep accumulating
      continue;
    }

    // Customer header row?
    const hdr = parseCustomerHeader(first);
    if (hdr) {
      const key = normalizeCompany(hdr.customer);
      if (!totals.has(key)) {
        totals.set(key, {
          displayName: hdr.customer,
          ff: 0,
          fs: 0,
          fb: 0,
          fg: 0,
          fc: 0,
          fd: 0,
          lastServiceDate: null,
        });
      }
      const t = totals.get(key)!;
      // Latest of any seen
      if (
        hdr.dateISO &&
        (t.lastServiceDate === null || hdr.dateISO > t.lastServiceDate)
      ) {
        t.lastServiceDate = hdr.dateISO;
      }
      current = { key, totals: t };
      continue;
    }

    // Service line — first cell is a service code (FF / FS / FB / FG / FC / FD)
    if (current) {
      const code = first.toUpperCase();
      const key = SERVICE_CODE_TO_KEY[code];
      if (key) {
        const amount = parseAmount(row[4]);
        current.totals[key] += amount;
      }
    }
    // anything else (totals row, blank, etc.) ignored
  }

  return totals;
}

// ============================================================================
// DIFF
// ============================================================================

export type ServiceProfile = {
  ff?: { active?: boolean; monthly_revenue?: number; last_service_date?: string };
  fs?: { active?: boolean; monthly_revenue?: number; last_service_date?: string };
  fb?: { active?: boolean; monthly_revenue?: number; last_service_date?: string };
  fg?: { active?: boolean; monthly_revenue?: number; last_service_date?: string };
  fc?: { active?: boolean; monthly_revenue?: number; last_service_date?: string };
  fd?: { active?: boolean; monthly_revenue?: number; last_service_date?: string };
};

export type DiffRow = {
  /** What we'll do on apply. */
  action: "insert" | "update" | "no_op" | "unmatched";
  /** Existing account id (null for inserts and unmatched). */
  accountId: string | null;
  /** Display name from the CSV. */
  csvCustomerName: string;
  /** Existing account name if matched (helps when the CSV name differs). */
  matchedCompanyName: string | null;
  /** Normalized name used for matching. */
  normalizedKey: string;
  /** Pre-image of the service_profile JSON (null for inserts). */
  before: ServiceProfile | null;
  /** Post-image we'd write. */
  after: ServiceProfile;
  /** MRR delta vs the existing service_profile (positive = increase). */
  mrrDelta: number;
};

export type DiffResult = {
  rows: DiffRow[];
  totals: {
    insert: number;
    update: number;
    noOp: number;
    unmatched: number;
    mrrDeltaSum: number;
  };
};

const SERVICE_KEYS = ["ff", "fs", "fb", "fg", "fc", "fd"] as const;

function mrrFromProfile(p: ServiceProfile | null): number {
  if (!p) return 0;
  let s = 0;
  for (const k of SERVICE_KEYS) {
    s += p[k]?.monthly_revenue ?? 0;
  }
  return s;
}

/**
 * Compute the per-account diff between the CSV-derived totals and the
 * current state. The action's apply step writes exactly what the diff says
 * — no further computation.
 *
 * @param csvTotals  Output of parseBillingCsvText
 * @param accounts   Existing accounts indexed by normalizedCompanyName.
 *                   Each entry needs id, companyName, and the current
 *                   service_profile.
 */
export function computeBillingDiff(
  csvTotals: Map<string, CustomerTotals>,
  accountsByKey: Map<
    string,
    { id: string; companyName: string; serviceProfile: ServiceProfile | null }
  >,
): DiffResult {
  const rows: DiffRow[] = [];
  let inserts = 0;
  let updates = 0;
  let noOps = 0;
  let unmatched = 0;
  let mrrDeltaSum = 0;

  for (const [key, t] of csvTotals.entries()) {
    const match = accountsByKey.get(key);
    // Build the post-image: existing fields preserved, services with
    // CSV-derived revenue updated. A service line with $0 in the CSV is
    // treated as "still active but billed nothing this period" — we keep
    // the active flag but update last_service_date if it advanced.
    const before = match?.serviceProfile ?? null;
    const after: ServiceProfile = {
      ...(before ?? {}),
    };
    let touchedAny = false;
    for (const k of SERVICE_KEYS) {
      const csvAmount = t[k];
      if (csvAmount === 0 && !(before?.[k]?.monthly_revenue)) continue;
      const existing = before?.[k] ?? {};
      const newEntry = {
        active: csvAmount > 0 ? true : (existing.active ?? false),
        monthly_revenue: csvAmount > 0 ? csvAmount : (existing.monthly_revenue ?? 0),
        last_service_date: t.lastServiceDate ?? existing.last_service_date,
      };
      // Only counts as "touched" if anything actually differs
      if (
        newEntry.active !== existing.active ||
        Math.abs(newEntry.monthly_revenue - (existing.monthly_revenue ?? 0)) > 0.005 ||
        newEntry.last_service_date !== existing.last_service_date
      ) {
        touchedAny = true;
      }
      after[k] = newEntry;
    }

    const beforeMrr = mrrFromProfile(before);
    const afterMrr = mrrFromProfile(after);
    const mrrDelta = Math.round((afterMrr - beforeMrr) * 100) / 100;

    if (!match) {
      // Unmatched — we don't auto-create accounts on monthly updates;
      // operator should investigate. (The bulk W1 script handles inserts.)
      rows.push({
        action: "unmatched",
        accountId: null,
        csvCustomerName: t.displayName,
        matchedCompanyName: null,
        normalizedKey: key,
        before: null,
        after,
        mrrDelta: afterMrr,
      });
      unmatched += 1;
      mrrDeltaSum += afterMrr;
      continue;
    }

    if (!touchedAny) {
      rows.push({
        action: "no_op",
        accountId: match.id,
        csvCustomerName: t.displayName,
        matchedCompanyName: match.companyName,
        normalizedKey: key,
        before,
        after: before ?? {},
        mrrDelta: 0,
      });
      noOps += 1;
      continue;
    }

    rows.push({
      action: "update",
      accountId: match.id,
      csvCustomerName: t.displayName,
      matchedCompanyName: match.companyName,
      normalizedKey: key,
      before,
      after,
      mrrDelta,
    });
    updates += 1;
    mrrDeltaSum += mrrDelta;
  }

  return {
    rows,
    totals: {
      insert: inserts,
      update: updates,
      noOp: noOps,
      unmatched,
      mrrDeltaSum: Math.round(mrrDeltaSum * 100) / 100,
    },
  };
}

// ============================================================================
// HASH
// ============================================================================

/** Stable hash for idempotency — same bytes = same hash. */
export function hashCsvBytes(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
