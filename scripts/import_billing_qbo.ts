// Import QBO (QuickBooks Online) per-customer billing and CORRECT the
// service_profile on matching Accounts. This supersedes the FiltaSymphony
// billing import (scripts/import_billing.ts) as the source of truth.
//
// WHY THIS EXISTS
// ---------------
// The FiltaSymphony billing summary the original import reads materially
// UNDERSTATES the truth (confirmed by the Jun 2026 QBO reconciliation):
//   - FiltaClean (FS): Symphony captured ~5% of real FS revenue. Symphony
//     has no native FiltaClean billing object. QBO shows 19 customers carry
//     FiltaClean (incl. SpaceX at ~$13.5k/mo), not the ~5 Symphony implied.
//   - FiltaGold (FG): Symphony's "FG" line is "Oil Sold to Customer" (≈$0),
//     NOT the FiltaGold deep-clean service. The schema's `fg` was therefore
//     never populated. QBO account 47750 "Filta Gold Service" is the real
//     FiltaGold and IS captured here.
//   - FiltaFry (FF): QBO invoiced amounts are the actual billed figures.
//
// This is the data that powers the FiltaClean Cross-Sell Dashboard, so
// getting FS right is the whole point: a customer who already has FS must
// NOT show up as a cross-sell target.
//
// QBO = system of record. Run this AFTER import:billing so the FiltaBio (fb)
// "active" flag from Symphony is preserved; this script only overwrites
// ff / fs / fg and leaves fb / fc / fd / fg_oil_sold untouched (merge).
//
// Input: data/qbo_billing_2026.csv (built from the QBO "Sales by Customer
// Detail" export, Jan-May 2026, 5-month average, "The Filta Group"
// HQ/intercompany line excluded). Columns:
//   company_name, ff_monthly, fs_monthly, fg_monthly, last_service_date
//
// Usage:
//   QBO_BILLING_CSV=data/qbo_billing_2026.csv npm run import:billing:qbo
//   LOOSE_MATCH=1 npm run import:billing:qbo   # enable fuzzy name matching

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import levenshtein from "fast-levenshtein";
import { eq } from "drizzle-orm";
import { db, pool, accounts } from "../src/db";
import type { ServiceProfile } from "../src/db/schema";

const DEFAULT_CSV = path.join(process.cwd(), "data", "qbo_billing_2026.csv");
const CSV_PATH = process.env.QBO_BILLING_CSV ?? DEFAULT_CSV;

const LOOSE =
  (process.env.LOOSE_MATCH ?? "").toLowerCase() === "1" ||
  (process.env.LOOSE_MATCH ?? "").toLowerCase() === "true";

type QboRow = {
  displayName: string;
  ff: number;
  fs: number;
  fg: number;
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

// Same normalizers as scripts/import_billing.ts so matching is identical.
function normalizeCompany(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(LLC|INC|CORP|CO|COMPANY|LTD|LP|LLP|THE|OF)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyLoose(name: string): string {
  let s = name;
  s = s.replace(/^\s*\([^)]*\)\s*/g, "");
  s = s.replace(/^\s*\d{2,6}\s*-?\s*/g, "");
  s = s.replace(/\s*-\s*(CLOSING|PENDING|CLOSED|INACTIVE|TEMPCLOSED)\s*$/gi, "");
  return normalizeCompany(s);
}

function readQboRows(csvPath: string): QboRow[] {
  const raw = fs.readFileSync(csvPath);
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  }) as Record<string, string>[];

  const rows: QboRow[] = [];
  for (const r of records) {
    const displayName = (r.company_name ?? "").trim();
    if (!displayName) continue;
    rows.push({
      displayName,
      ff: parseAmount(r.ff_monthly),
      fs: parseAmount(r.fs_monthly),
      fg: parseAmount(r.fg_monthly),
      lastServiceDate: (r.last_service_date ?? "").trim() || null,
    });
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Account matching (ported verbatim from scripts/import_billing.ts)
// ----------------------------------------------------------------------------

type AccountLite = {
  id: string;
  companyName: string;
  companyNormalized: string;
  companyLoose: string;
};

const LOOSE_TARGET_BLACKLIST = new Set(
  [
    "DAYTONA BEACH", "DAYTONA", "PORT ORANGE", "SOUTH DAYTONA", "HOLLY HILL",
    "ORMOND BEACH", "ORMOND", "NEW SMYRNA BEACH", "EDGEWATER", "DELAND",
    "DELTONA", "DEBARY", "ORANGE CITY", "PIERSON", "SEVILLE", "OAK HILL",
    "PONCE INLET", "FLAGLER BEACH", "PALM COAST", "BUNNELL",
    "MELBOURNE", "PALM BAY", "COCOA", "COCOA BEACH", "ROCKLEDGE",
    "MERRITT ISLAND", "TITUSVILLE", "MIMS", "SATELLITE BEACH", "VIERA",
    "CAPE CANAVERAL", "INDIALANTIC", "INDIAN HARBOUR BEACH",
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
  const direct = accountsByName.get(key);
  if (direct) {
    const a = allAccounts.find((x) => x.id === direct);
    return { id: direct, how: "direct", matchedTo: a?.companyName ?? "" };
  }

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

  const looseHits = accountsByLoose.get(keyLoose);
  if (looseHits && looseHits.length === 1) {
    return { id: looseHits[0].id, how: "loose-direct", matchedTo: looseHits[0].companyName };
  }
  if (looseHits && looseHits.length > 1) {
    const pick = looseHits[0];
    return {
      id: pick.id,
      how: "loose-direct",
      matchedTo: `${pick.companyName} (+${looseHits.length - 1} dup)`,
    };
  }

  if (keyLoose.length >= 8) {
    const substring = allAccounts.find(
      (a) =>
        a.companyLoose.length >= 8 &&
        !LOOSE_TARGET_BLACKLIST.has(a.companyLoose) &&
        (a.companyLoose.includes(keyLoose) || keyLoose.includes(a.companyLoose)),
    );
    if (substring) {
      return { id: substring.id, how: "loose-substring", matchedTo: substring.companyName };
    }
  }

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
    return { id: bestLoose.id, how: "loose-fuzzy", matchedTo: bestLoose.matched };
  }

  return null;
}

const round2 = (n: number) => +n.toFixed(2);

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`QBO billing CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const qboRows = readQboRows(CSV_PATH);
  console.log(`Read ${qboRows.length} QBO customers from ${path.basename(CSV_PATH)}.`);

  const allAccounts: AccountLite[] = (
    await db
      .select({ id: accounts.id, companyName: accounts.companyName })
      .from(accounts)
  ).map((a) => ({
    id: a.id,
    companyName: a.companyName,
    companyNormalized: normalizeCompany(a.companyName),
    companyLoose: normalizeCompanyLoose(a.companyName),
  }));

  // Existing service_profile per account so we can MERGE (preserve fb/fc/fd
  // and any fg_oil_sold the Symphony import wrote).
  const existingProfiles = new Map<string, Record<string, unknown>>();
  for (const a of await db
    .select({ id: accounts.id, serviceProfile: accounts.serviceProfile })
    .from(accounts)) {
    existingProfiles.set(a.id, (a.serviceProfile as Record<string, unknown>) ?? {});
  }

  const accountsByName = new Map<string, string>();
  for (const a of allAccounts) accountsByName.set(a.companyNormalized, a.id);

  const accountsByLoose = new Map<string, AccountLite[]>();
  for (const a of allAccounts) {
    if (!a.companyLoose) continue;
    const arr = accountsByLoose.get(a.companyLoose) ?? [];
    arr.push(a);
    accountsByLoose.set(a.companyLoose, arr);
  }

  if (LOOSE) console.log(`Loose-match mode ENABLED (LOOSE_MATCH=1).`);

  // Resolve each QBO row to an accountId, summing if several map to one.
  type Aggregated = {
    ff: number;
    fs: number;
    fg: number;
    lastServiceDate: string | null;
    sources: string[];
  };
  const byAccount = new Map<string, Aggregated>();
  const unmatched: string[] = [];
  const looseMatches: { from: string; to: string; how: string }[] = [];

  for (const r of qboRows) {
    const key = normalizeCompany(r.displayName);
    const keyLoose = normalizeCompanyLoose(r.displayName);
    const m = matchAccount(key, keyLoose, accountsByName, accountsByLoose, allAccounts);
    if (!m) {
      unmatched.push(r.displayName);
      continue;
    }
    if (m.how !== "direct") {
      looseMatches.push({ from: r.displayName, to: m.matchedTo, how: m.how });
    }
    const agg = byAccount.get(m.id) ?? {
      ff: 0, fs: 0, fg: 0, lastServiceDate: null, sources: [],
    };
    agg.ff += r.ff;
    agg.fs += r.fs;
    agg.fg += r.fg;
    if (
      r.lastServiceDate &&
      (!agg.lastServiceDate || r.lastServiceDate > agg.lastServiceDate)
    ) {
      agg.lastServiceDate = r.lastServiceDate;
    }
    agg.sources.push(r.displayName);
    byAccount.set(m.id, agg);
  }

  // One write per resolved account: MERGE QBO ff/fs/fg over the existing
  // profile, flip account_status='customer' when there is any revenue.
  let updated = 0;
  let flippedToCustomer = 0;
  let fsActive = 0;
  const merged: { account: string; sources: string[] }[] = [];

  for (const [accountId, agg] of byAccount.entries()) {
    const last = agg.lastServiceDate ?? undefined;
    const existing = existingProfiles.get(accountId) ?? {};

    const serviceProfile: ServiceProfile & Record<string, unknown> = {
      ...(existing as ServiceProfile),
      ff: { active: agg.ff > 0, monthly_revenue: round2(agg.ff), last_service_date: last },
      fs: { active: agg.fs > 0, monthly_revenue: round2(agg.fs), last_service_date: last },
      fg: { active: agg.fg > 0, monthly_revenue: round2(agg.fg), last_service_date: last },
    };

    const hasRevenue = agg.ff > 0 || agg.fs > 0 || agg.fg > 0;

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
    if (agg.fs > 0) fsActive += 1;
    if (agg.sources.length > 1) {
      const acct = allAccounts.find((a) => a.id === accountId);
      merged.push({ account: acct?.companyName ?? accountId, sources: agg.sources });
    }
  }

  console.log(`QBO billing import complete:`);
  console.log(`  Accounts updated:        ${updated}`);
  console.log(`  Confirmed 'customer':    ${flippedToCustomer}`);
  console.log(`  FiltaClean (fs) active:  ${fsActive}   <- cross-sell dashboard now correct`);
  console.log(`  Loose matches (review):  ${looseMatches.length}`);
  console.log(`  Multi-row merges:        ${merged.length}`);
  console.log(`  Unmatched customers:     ${unmatched.length}`);
  if (looseMatches.length) {
    console.log(`\n  Loose matches (QBO -> CRM account):`);
    for (const lm of looseMatches) console.log(`    [${lm.how}] ${lm.from}  ->  ${lm.to}`);
  }
  if (merged.length) {
    console.log(`\n  Multi-row merges:`);
    for (const m of merged) console.log(`    ${m.account}  <-  [${m.sources.join(", ")}]`);
  }
  if (unmatched.length) {
    console.log(`\n  Unmatched (${unmatched.length}): ${unmatched.join(", ")}`);
    console.log(`  (Re-run with LOOSE_MATCH=1, or add these accounts manually - e.g. SpaceX sub-locations.)`);
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
