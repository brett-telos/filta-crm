// Import FiltaSymphony billing summary CSVs and populate service_profile on
// matching Accounts. This is what powers the FiltaClean Cross-Sell Dashboard:
// any customer with FF active + FS inactive + no open FS opp is a target.
//
// Input: CRM Exports/260415_XXXXXX_billing_summary.csv (3 monthly files)
//   Structure:
//     Row 1:  "MM/DD/YYYY - MM/DD/YYYY"          (invoice period)
//     Row 2:  "Franchisee - <Name>"              (franchisee owner)
//     Row 3:  blank
//     Row 4:  column headers
//     Repeating customer blocks:
//       "<Customer Name>: MM/DD/YYYY HH:MMam|pm | <Status>"
//       "<ServiceCode>","<desc>","<qty>","<rate>","<amount>"
//       ... more service lines ...
//       "","","","Total","$<amount>"
//
// Service codes seen: FF, FS, FB, FG
//   FF = FiltaFry core oil filtration                → service_profile.ff
//   FS = FiltaClean / FiltaShield steam cleaning     → service_profile.fs
//   FB = FiltaBio waste oil collection               → service_profile.fb
//   FG = Oil Sold to Customer (typically $0.00) — intentionally not
//        aggregated into the schema's "fg" FiltaGold bucket because
//        FiltaGold is a different service. Captured as a raw number
//        in service_profile.fg_oil_sold for future reporting.
//
// Output: for each customer we can match to an account, compute the 3-month
// total per service, divide by 3 = average monthly revenue, and write into
// the account's service_profile JSONB. We also flip account_status=customer
// when a match has any non-zero revenue.
//
// Usage:
//   BILLING_DIR=/path/to/dir npm run import:billing
//   # dir should contain 260415_*_billing_summary.csv (any count, each ~1mo)

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import levenshtein from "fast-levenshtein";
import { eq } from "drizzle-orm";
import { db, pool, accounts } from "../src/db";
import type { ServiceProfile } from "../src/db/schema";

const DEFAULT_DIR = path.join(process.cwd(), "data");
const BILLING_DIR = process.env.BILLING_DIR ?? DEFAULT_DIR;

type CustomerTotals = {
  displayName: string;
  ff: number;
  fs: number;
  fb: number;
  fgOilSold: number;
  lastServiceDate: string | null;
};

// ----------------------------------------------------------------------------
// CSV parsing
// ----------------------------------------------------------------------------

function parseAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = String(raw).replace(/[^0-9.\-]/g, "");
  const n = Number.parseFloat(m);
  return Number.isFinite(n) ? n : 0;
}

function parseCustomerHeader(
  cell: string,
): { customer: string; dateISO: string | null } | null {
  // Examples:
  //   "31 Supper Club: 03/10/2026 12:00am | Performed"
  //   "AdventHealth DeLand: 03/02/2026 12:00am | Performed"
  //   "La Fiesta: 03/17/2026 12:00am | Cancelled"
  const cleaned = cell.replace(/^["'\s]+/, "").replace(/["'\s]+$/, "");
  const m = cleaned.match(
    /^(.+?):\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d{1,2}:\d{2}(?:am|pm)?\s*\|\s*\w+/i,
  );
  if (!m) return null;
  const [, customer, mo, dy, yr] = m;
  const dateISO = `${yr}-${mo.padStart(2, "0")}-${dy.padStart(2, "0")}`;
  return { customer: customer.trim(), dateISO };
}

function normalizeCompany(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(LLC|INC|CORP|CO|COMPANY|LTD|LP|LLP|THE|OF)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBillingFile(filePath: string, totals: Map<string, CustomerTotals>) {
  const raw = fs.readFileSync(filePath);
  // Parse loosely — rows have variable column counts. csv-parse gives us
  // arrays of strings per line, which is easier than the object mode.
  const rows = parse(raw, {
    columns: false,
    skip_empty_lines: false,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  }) as string[][];

  let current: { key: string; display: string; dateISO: string | null } | null = null;

  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const first = (row[0] ?? "").trim();
    if (!first) continue;

    // Customer header row (single cell with "Name: date | status")
    const parsed = parseCustomerHeader(first);
    if (parsed) {
      const key = normalizeCompany(parsed.customer);
      current = { key, display: parsed.customer, dateISO: parsed.dateISO };
      if (!totals.has(key)) {
        totals.set(key, {
          displayName: parsed.customer,
          ff: 0,
          fs: 0,
          fb: 0,
          fgOilSold: 0,
          lastServiceDate: parsed.dateISO,
        });
      } else {
        const t = totals.get(key)!;
        if (
          parsed.dateISO &&
          (!t.lastServiceDate || parsed.dateISO > t.lastServiceDate)
        ) {
          t.lastServiceDate = parsed.dateISO;
        }
      }
      continue;
    }

    if (!current) continue;

    // Service line: ["FF", "...", "qty", "rate", "$amount"]
    const code = first.toUpperCase();
    if (["FF", "FS", "FB", "FG"].includes(code)) {
      const amount = parseAmount(row[4]);
      const t = totals.get(current.key)!;
      if (code === "FF") t.ff += amount;
      else if (code === "FS") t.fs += amount;
      else if (code === "FB") t.fb += amount;
      else if (code === "FG") t.fgOilSold += amount;
      continue;
    }

    // Header rows / period / franchisee / Total line — ignore.
  }
}

// ----------------------------------------------------------------------------
// Account matching
// ----------------------------------------------------------------------------

type AccountLite = { id: string; companyNormalized: string };

function matchAccount(
  key: string,
  accountsByName: Map<string, string>,
  allAccounts: AccountLite[],
): string | null {
  const direct = accountsByName.get(key);
  if (direct) return direct;
  // Fuzzy — find any account within 20% edit distance
  let best: { id: string; score: number } | null = null;
  for (const a of allAccounts) {
    const dist = levenshtein.get(a.companyNormalized, key);
    const len = Math.max(a.companyNormalized.length, key.length, 1);
    const score = dist / len;
    if (score <= 0.2 && (!best || score < best.score)) {
      best = { id: a.id, score };
    }
  }
  return best ? best.id : null;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(BILLING_DIR)) {
    console.error(`Billing dir not found: ${BILLING_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(BILLING_DIR)
    .filter((f) => /billing_summary\.csv$/i.test(f))
    .map((f) => path.join(BILLING_DIR, f));

  if (files.length === 0) {
    console.error(`No *billing_summary.csv files found in ${BILLING_DIR}`);
    process.exit(1);
  }

  console.log(`Parsing ${files.length} billing file(s): ${files.map((f) => path.basename(f)).join(", ")}`);

  const totals = new Map<string, CustomerTotals>();
  for (const file of files) parseBillingFile(file, totals);

  console.log(`Extracted ${totals.size} distinct customers from billing.`);

  const months = files.length || 1; // assume 1 file = 1 month

  const allAccounts = (
    await db
      .select({ id: accounts.id, companyName: accounts.companyName })
      .from(accounts)
  ).map((a) => ({ ...a, companyNormalized: normalizeCompany(a.companyName) }));

  const accountsByName = new Map<string, string>();
  for (const a of allAccounts) accountsByName.set(a.companyNormalized, a.id);

  const unmatched: string[] = [];
  let updated = 0;

  for (const [key, t] of totals.entries()) {
    const accountId = matchAccount(key, accountsByName, allAccounts);
    if (!accountId) {
      unmatched.push(t.displayName);
      continue;
    }

    const serviceProfile: ServiceProfile & { fg_oil_sold?: { monthly_revenue: number } } = {
      ff: {
        active: t.ff > 0,
        monthly_revenue: +(t.ff / months).toFixed(2),
        last_service_date: t.lastServiceDate ?? undefined,
      },
      fs: {
        active: t.fs > 0,
        monthly_revenue: +(t.fs / months).toFixed(2),
        last_service_date: t.lastServiceDate ?? undefined,
      },
      fb: {
        active: t.fb > 0,
        monthly_revenue: +(t.fb / months).toFixed(2),
        last_service_date: t.lastServiceDate ?? undefined,
      },
    };
    if (t.fgOilSold > 0) {
      // Stored separately from the schema's fg (FiltaGold) bucket.
      (serviceProfile as Record<string, unknown>).fg_oil_sold = {
        monthly_revenue: +(t.fgOilSold / months).toFixed(2),
      };
    }

    const hasRevenue = t.ff > 0 || t.fs > 0 || t.fb > 0 || t.fgOilSold > 0;

    await db
      .update(accounts)
      .set({
        serviceProfile,
        ...(hasRevenue ? { accountStatus: "customer" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
    updated += 1;
  }

  console.log(`Billing import complete:`);
  console.log(`  Accounts updated: ${updated}`);
  console.log(`  Unmatched customers: ${unmatched.length}`);
  if (unmatched.length) {
    console.log(
      `  First 20 unmatched: ${unmatched.slice(0, 20).join(", ")}${
        unmatched.length > 20 ? ", ..." : ""
      }`,
    );
    console.log(
      `  (Unmatched customers usually need a lead record first — run import:leads before this, or add them manually.)`,
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
