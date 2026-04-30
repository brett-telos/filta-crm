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

// LOOSE_MATCH=1 enables an aggressive name-only matcher that strips
// noisy lead-CSV prefixes ("1003 - ", "(Handled Locally) ", etc.),
// trailing junk (" - CLOSING"), tries substring containment, and uses a
// looser levenshtein threshold. Logs every loose match for review.
// Strict parsing — only "1" or "true" enable; "0"/"false"/"" disable.
const LOOSE = ((process.env.LOOSE_MATCH ?? "").toLowerCase() === "1" ||
  (process.env.LOOSE_MATCH ?? "").toLowerCase() === "true");

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
  const m = cell.match(
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

// Stronger normalizer for loose matching. Strips lead-CSV-specific
// prefixes/suffixes that the standard normalizer leaves intact:
//   - "(Handled Locally) Foo Bar"     → "FOO BAR"
//   - "(NA - status pending) Foo"     → "FOO"
//   - "1003 - Foo Bar"                → "FOO BAR"
//   - "11155 - Florida Hospital X"    → "FLORIDA HOSPITAL X"
//   - "Foo Bar - CLOSING"             → "FOO BAR"
//   - "Foo Bar - PENDING"             → "FOO BAR"
function normalizeCompanyLoose(name: string): string {
  let s = name;
  // Strip leading parenthetical annotations.
  s = s.replace(/^\s*\([^)]*\)\s*/g, "");
  // Strip leading numeric account number prefix like "1003 - " or "11155-".
  s = s.replace(/^\s*\d{2,6}\s*-?\s*/g, "");
  // Strip trailing status suffix tags.
  s = s.replace(/\s*-\s*(CLOSING|PENDING|CLOSED|INACTIVE|TEMPCLOSED)\s*$/gi, "");
  return normalizeCompany(s);
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

type AccountLite = {
  id: string;
  companyName: string;
  companyNormalized: string;
  companyLoose: string;
};

// Targets that should never win a loose substring/fuzzy match — these are
// city, region, or generic single-word account names that exist in the
// CRM as data junk and would otherwise hijack any billing row containing
// the city name (e.g. "Sonny's BBQ-Port Orange" → "PORT ORANGE").
const LOOSE_TARGET_BLACKLIST = new Set(
  [
    // Volusia / Flagler / Brevard cities
    "DAYTONA BEACH", "DAYTONA", "PORT ORANGE", "SOUTH DAYTONA", "HOLLY HILL",
    "ORMOND BEACH", "ORMOND", "NEW SMYRNA BEACH", "EDGEWATER", "DELAND",
    "DELTONA", "DEBARY", "ORANGE CITY", "PIERSON", "SEVILLE", "OAK HILL",
    "PONCE INLET", "FLAGLER BEACH", "PALM COAST", "BUNNELL",
    "MELBOURNE", "PALM BAY", "COCOA", "COCOA BEACH", "ROCKLEDGE",
    "MERRITT ISLAND", "TITUSVILLE", "MIMS", "SATELLITE BEACH", "VIERA",
    "CAPE CANAVERAL", "INDIALANTIC", "INDIAN HARBOUR BEACH",
    // Generic single-word names that appeared as bad CRM rows
    "SPEEDWAY", "VFW POST", "POST", "TAVERN", "CAFE", "GRILL", "KITCHEN",
    "RESTAURANT", "BAR",
  ].map((s) => normalizeCompanyLoose(s)),
);

type MatchResult = {
  id: string;
  how: "direct" | "loose-direct" | "loose-substring" | "loose-fuzzy";
  matchedTo: string;
};

function matchAccount(
  key: string,
  keyLoose: string,
  accountsByName: Map<string, string>,
  accountsByLoose: Map<string, AccountLite[]>,
  allAccounts: AccountLite[],
): MatchResult | null {
  // 1. Standard direct match (normalizeCompany on both sides).
  const direct = accountsByName.get(key);
  if (direct) {
    const a = allAccounts.find((x) => x.id === direct);
    return { id: direct, how: "direct", matchedTo: a?.companyName ?? "" };
  }

  // 2. Standard fuzzy (≤20% edit distance). Skip blacklisted city/generic
  //    targets so the standard tier can't sneak past loose-tier safeguards.
  let best: { id: string; score: number; matched: string } | null = null;
  for (const a of allAccounts) {
    if (LOOSE_TARGET_BLACKLIST.has(a.companyLoose)) continue;
    const dist = levenshtein.get(a.companyNormalized, key);
    const len = Math.max(a.companyNormalized.length, key.length, 1);
    const score = dist / len;
    if (score <= 0.2 && (!best || score < best.score)) {
      best = { id: a.id, score, matched: a.companyName };
    }
  }
  if (best) return { id: best.id, how: "direct", matchedTo: best.matched };

  if (!LOOSE) return null;

  // 3. LOOSE-DIRECT: stripped-name exact match. Catches the common case of
  //    "Foo Bar" billing vs "1003 - Foo Bar" account.
  const looseHits = accountsByLoose.get(keyLoose);
  if (looseHits && looseHits.length === 1) {
    return {
      id: looseHits[0].id,
      how: "loose-direct",
      matchedTo: looseHits[0].companyName,
    };
  }
  // If multiple accounts share the same loose key, prefer one already
  // marked as a customer (most likely the canonical record).
  if (looseHits && looseHits.length > 1) {
    const pick = looseHits[0]; // tie-break: first; logged for review
    return {
      id: pick.id,
      how: "loose-direct",
      matchedTo: `${pick.companyName} (+${looseHits.length - 1} dup)`,
    };
  }

  // 4. LOOSE-SUBSTRING: one stripped name contains the other. Requires
  //    both sides to be at least 8 chars and the matched account NOT to
  //    be a city/generic blacklisted target.
  if (keyLoose.length >= 8) {
    const substring = allAccounts.find(
      (a) =>
        a.companyLoose.length >= 8 &&
        !LOOSE_TARGET_BLACKLIST.has(a.companyLoose) &&
        (a.companyLoose.includes(keyLoose) || keyLoose.includes(a.companyLoose)),
    );
    if (substring) {
      return {
        id: substring.id,
        how: "loose-substring",
        matchedTo: substring.companyName,
      };
    }
  }

  // 5. LOOSE-FUZZY: levenshtein on stripped names. Tightened to 0.22 to
  //    avoid pairings like "Tipsy Tavern" → "R J's Tavern".
  let bestLoose: { id: string; score: number; matched: string } | null = null;
  for (const a of allAccounts) {
    if (a.companyLoose.length < 4 || keyLoose.length < 4) continue;
    if (LOOSE_TARGET_BLACKLIST.has(a.companyLoose)) continue;
    const dist = levenshtein.get(a.companyLoose, keyLoose);
    const len = Math.max(a.companyLoose.length, keyLoose.length, 1);
    const score = dist / len;
    if (score <= 0.22 && (!bestLoose || score < bestLoose.score)) {
      bestLoose = { id: a.id, score, matched: a.companyName };
    }
  }
  if (bestLoose) {
    return {
      id: bestLoose.id,
      how: "loose-fuzzy",
      matchedTo: bestLoose.matched,
    };
  }

  return null;
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
    .filter((f) => /billing_summary.*\.csv$/i.test(f))
    .map((f) => path.join(BILLING_DIR, f));

  if (files.length === 0) {
    console.error(`No *billing_summary*.csv files found in ${BILLING_DIR}`);
    process.exit(1);
  }

  console.log(`Parsing ${files.length} billing file(s): ${files.map((f) => path.basename(f)).join(", ")}`);

  const totals = new Map<string, CustomerTotals>();
  for (const file of files) parseBillingFile(file, totals);

  console.log(`Extracted ${totals.size} distinct customers from billing.`);

  const months = files.length || 1; // assume 1 file = 1 month

  const allAccounts: AccountLite[] = (
    await db
      .select({ id: accounts.id, companyName: accounts.companyName })
      .from(accounts)
  ).map((a) => ({
    ...a,
    companyNormalized: normalizeCompany(a.companyName),
    companyLoose: normalizeCompanyLoose(a.companyName),
  }));

  const accountsByName = new Map<string, string>();
  for (const a of allAccounts) accountsByName.set(a.companyNormalized, a.id);

  const accountsByLoose = new Map<string, AccountLite[]>();
  for (const a of allAccounts) {
    if (!a.companyLoose) continue;
    const arr = accountsByLoose.get(a.companyLoose) ?? [];
    arr.push(a);
    accountsByLoose.set(a.companyLoose, arr);
  }

  if (LOOSE) {
    console.log(`Loose-match mode ENABLED (LOOSE_MATCH=1).`);
  }

  const unmatched: string[] = [];
  const looseMatches: { from: string; to: string; how: string }[] = [];

  // Phase 1: resolve every billing customer to an accountId, summing
  // revenues per accountId. This makes Halifax Health-style multi-row →
  // single-account mappings sum (instead of last-write-wins overwrite).
  type Aggregated = {
    ff: number;
    fs: number;
    fb: number;
    fgOilSold: number;
    lastServiceDate: string | null;
    sources: string[]; // billing display names that fed this account
  };
  const byAccount = new Map<string, Aggregated>();

  for (const [key, t] of totals.entries()) {
    const keyLoose = normalizeCompanyLoose(t.displayName);
    const m = matchAccount(
      key,
      keyLoose,
      accountsByName,
      accountsByLoose,
      allAccounts,
    );
    if (!m) {
      unmatched.push(t.displayName);
      continue;
    }
    if (m.how !== "direct") {
      looseMatches.push({ from: t.displayName, to: m.matchedTo, how: m.how });
    }
    const agg = byAccount.get(m.id) ?? {
      ff: 0, fs: 0, fb: 0, fgOilSold: 0, lastServiceDate: null, sources: [],
    };
    agg.ff += t.ff;
    agg.fs += t.fs;
    agg.fb += t.fb;
    agg.fgOilSold += t.fgOilSold;
    if (
      t.lastServiceDate &&
      (!agg.lastServiceDate || t.lastServiceDate > agg.lastServiceDate)
    ) {
      agg.lastServiceDate = t.lastServiceDate;
    }
    agg.sources.push(t.displayName);
    byAccount.set(m.id, agg);
  }

  // Phase 2: one DB write per resolved account, with summed revenues.
  let updated = 0;
  let flippedToCustomer = 0;
  const merged: { account: string; sources: string[] }[] = [];

  for (const [accountId, agg] of byAccount.entries()) {
    const serviceProfile: ServiceProfile & { fg_oil_sold?: { monthly_revenue: number } } = {
      ff: {
        active: agg.ff > 0,
        monthly_revenue: +(agg.ff / months).toFixed(2),
        last_service_date: agg.lastServiceDate ?? undefined,
      },
      fs: {
        active: agg.fs > 0,
        monthly_revenue: +(agg.fs / months).toFixed(2),
        last_service_date: agg.lastServiceDate ?? undefined,
      },
      fb: {
        active: agg.fb > 0,
        monthly_revenue: +(agg.fb / months).toFixed(2),
        last_service_date: agg.lastServiceDate ?? undefined,
      },
    };
    if (agg.fgOilSold > 0) {
      (serviceProfile as Record<string, unknown>).fg_oil_sold = {
        monthly_revenue: +(agg.fgOilSold / months).toFixed(2),
      };
    }

    const hasRevenue =
      agg.ff > 0 || agg.fs > 0 || agg.fb > 0 || agg.fgOilSold > 0;

    await db
      .update(accounts)
      .set({
        serviceProfile,
        ...(hasRevenue ? { accountStatus: "customer" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
    updated += 1;
    if (hasRevenue) flippedToCustomer += 1;
    if (agg.sources.length > 1) {
      const acct = allAccounts.find((a) => a.id === accountId);
      merged.push({
        account: acct?.companyName ?? accountId,
        sources: agg.sources,
      });
    }
  }

  console.log(`Billing import complete:`);
  console.log(`  Accounts updated:           ${updated}`);
  console.log(`  Flipped to 'customer':      ${flippedToCustomer}`);
  console.log(`  Loose matches (review):     ${looseMatches.length}`);
  console.log(`  Multi-row merges:           ${merged.length}`);
  console.log(`  Unmatched customers:        ${unmatched.length}`);
  if (looseMatches.length) {
    console.log(`\n  Loose matches (billing → CRM account):`);
    for (const lm of looseMatches) {
      console.log(`    [${lm.how}] ${lm.from}  →  ${lm.to}`);
    }
  }
  if (merged.length) {
    console.log(`\n  Multi-row merges (revenue summed into one CRM account):`);
    for (const m of merged) {
      console.log(`    ${m.account}  ←  [${m.sources.join(", ")}]`);
    }
  }
  if (unmatched.length) {
    console.log(
      `\n  Unmatched (${unmatched.length}): ${unmatched.join(", ")}`,
    );
    console.log(
      `\n  (Re-run with LOOSE_MATCH=1 to enable name-only fuzzy matching, or add these accounts manually.)`,
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
