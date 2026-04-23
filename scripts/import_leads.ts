// Import Filta Symphony leads CSV into the CRM as Accounts (+ primary Contacts).
//
// Input: CRM Exports/filta_symphony_leads.csv (5,670 rows, as of Apr 2026)
//   Columns: Record ID, Company, Contact, City, Phone, Call Disposition,
//            Call Date, Fryers, Date Created, Sales Funnel, NCA
//
// Behaviour:
//   - Normalize phones to E.164 (US assumed).
//   - Look up city in city_county_mapping → territory. Unknown cities = unassigned.
//   - Dedup by (filta_record_id) first; fall back to fuzzy match on
//     normalized company name + matching phone.
//   - Map Filta "Sales Funnel" values → CRM pipeline stages (see SALES_FUNNEL_MAP).
//   - Flag NCAs (Avendra, Compass, Sodexo, Entegra, Aramark, Metz, etc.)
//   - Create a primary Contact from the "Contact" column if present.
//   - If Fryers > 0 and no FF opportunity exists, create one with
//     auto-estimated annual value = fryers * $300 * 12.
//
// Idempotent: re-running updates existing accounts in place rather than
// creating duplicates.
//
// Usage:
//   LEADS_CSV=/path/to/filta_symphony_leads.csv npm run import:leads
//   # defaults to ./data/filta_symphony_leads.csv if unset

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import levenshtein from "fast-levenshtein";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  accounts,
  contacts,
  opportunities,
  cityCountyMapping,
  servicePricingConfig,
} from "../src/db";

// ----------------------------------------------------------------------------
// Types & mappings
// ----------------------------------------------------------------------------

type LeadRow = {
  "Record ID": string;
  Company: string;
  Contact: string;
  City: string;
  Phone: string;
  "Call Disposition": string;
  "Call Date": string;
  Fryers: string;
  "Date Created": string;
  "Sales Funnel": string;
  NCA: string;
};

type PipelineStage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

// Based on the 13 distinct Sales Funnel values profiled during design.
// If a value isn't matched we default to 'new_lead' and log it.
const SALES_FUNNEL_MAP: Record<string, PipelineStage> = {
  Lead: "new_lead",
  "Cold Lead": "new_lead",
  "New Lead": "new_lead",
  Contacted: "contacted",
  "Initial Contact": "contacted",
  "Completed Meeting": "qualified",
  "Meeting Scheduled": "qualified",
  Qualified: "qualified",
  "Proposal Sent": "proposal",
  Proposal: "proposal",
  Quoted: "proposal",
  Negotiating: "negotiation",
  Negotiation: "negotiation",
  Won: "closed_won",
  "Closed Won": "closed_won",
  Customer: "closed_won",
  Lost: "closed_lost",
  "Closed Lost": "closed_lost",
  "Not Interested": "closed_lost",
  DNC: "closed_lost",
};

// NCA signatures — substring match, case-insensitive, on either the NCA
// column or the company name. When a record hits one of these, set
// nca_flag=true and nca_name=<canonical>.
const NCA_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /avendra/i, name: "Avendra" },
  { match: /compass/i, name: "Compass" },
  { match: /sodexo/i, name: "Sodexo" },
  { match: /entegra/i, name: "Entegra" },
  { match: /aramark/i, name: "Aramark" },
  { match: /\bmetz\b/i, name: "Metz" },
  { match: /delaware north/i, name: "Delaware North" },
  { match: /legends/i, name: "Legends" },
  { match: /\bhhs\b/i, name: "HHS" },
];

// Call disposition mapping — covers the 25 distinct values profiled.
const CALL_DISPOSITION_MAP: Record<string, string> = {
  "Number Disconnected": "number_disconnected",
  Disconnected: "number_disconnected",
  "No Answer": "no_answer",
  "Left Voicemail": "left_voicemail",
  "Left Message": "left_voicemail",
  Voicemail: "left_voicemail",
  "Wrong Number": "wrong_number",
  "Line Busy": "line_busy",
  Busy: "line_busy",
  "Not Interested": "not_interested",
  DNC: "dnc",
  "Do Not Call": "dnc",
  "Call Back": "callback_scheduled",
  "Callback Scheduled": "callback_scheduled",
  "Call Back Later": "callback_scheduled",
  "Call Back Next Week": "callback_scheduled",
  "Booked Meeting": "meeting_booked",
  "Meeting Booked": "meeting_booked",
  "Booked Site-Evaluation": "site_eval_booked",
  "Site Evaluation Booked": "site_eval_booked",
  "Demo Booked": "demo_booked",
  "DM Unavailable": "dm_unavailable",
  "Decision Maker Unavailable": "dm_unavailable",
  "Language Barrier": "language_barrier",
  "Corporate Decision": "corporate_decision",
  "Chain Decision": "chain_decision",
  "Not Qualified": "not_qualified",
  Connected: "connected",
};

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (parsed && parsed.isValid()) return parsed.number; // E.164
  // Fallback: strip everything but digits and format if 10/11 digit
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function normalizeCompany(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(LLC|INC|CORP|CO|COMPANY|LTD|LP|LLP|THE|OF)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return city.toUpperCase().trim();
}

function mapSalesFunnel(value: string | null | undefined): PipelineStage {
  if (!value) return "new_lead";
  const trimmed = value.trim();
  return SALES_FUNNEL_MAP[trimmed] ?? "new_lead";
}

function detectNca(ncaColumn: string, company: string): { flag: boolean; name: string | null } {
  const haystack = `${ncaColumn ?? ""} ${company ?? ""}`;
  for (const pat of NCA_PATTERNS) {
    if (pat.match.test(haystack)) return { flag: true, name: pat.name };
  }
  // Also honor any non-empty NCA column we don't have a pattern for yet
  if (ncaColumn && ncaColumn.trim()) return { flag: true, name: ncaColumn.trim() };
  return { flag: false, name: null };
}

function parseFryerCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFiltaDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  // Formats seen: "04/17/2026 08:20am"
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const m = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(am|pm)?)?/i,
  );
  if (!m) {
    const d = new Date(trimmed);
    return isNaN(d.valueOf()) ? null : d;
  }
  const [, mo, dy, yr, hrStr, minStr, ampm] = m;
  let hr = hrStr ? parseInt(hrStr, 10) : 0;
  const mn = minStr ? parseInt(minStr, 10) : 0;
  if (ampm?.toLowerCase() === "pm" && hr < 12) hr += 12;
  if (ampm?.toLowerCase() === "am" && hr === 12) hr = 0;
  return new Date(
    Date.UTC(parseInt(yr, 10), parseInt(mo, 10) - 1, parseInt(dy, 10), hr, mn),
  );
}

function splitContactName(raw: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
} {
  if (!raw) return { firstName: null, lastName: null, fullName: null };
  const full = raw.trim();
  if (!full) return { firstName: null, lastName: null, fullName: null };
  const parts = full.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null, fullName: full };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName, fullName: full };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

const DEFAULT_PATH = path.join(process.cwd(), "data", "filta_symphony_leads.csv");
const LEADS_CSV = process.env.LEADS_CSV ?? DEFAULT_PATH;

type TerritoryRow = { cityNormalized: string; county: string; territory: "fun_coast" | "space_coast" | "unassigned" };

async function loadTerritoryLookup(): Promise<Map<string, TerritoryRow>> {
  const rows = await db.select().from(cityCountyMapping);
  const map = new Map<string, TerritoryRow>();
  for (const r of rows) {
    map.set(r.cityNormalized, r);
  }
  return map;
}

type ExistingAccount = {
  id: string;
  companyName: string;
  companyNormalized: string;
  phone: string | null;
  filtaRecordId: string | null;
};

async function loadExistingAccounts(): Promise<ExistingAccount[]> {
  const rows = await db
    .select({
      id: accounts.id,
      companyName: accounts.companyName,
      phone: accounts.phone,
      filtaRecordId: accounts.filtaRecordId,
    })
    .from(accounts);
  return rows.map((r) => ({
    ...r,
    companyNormalized: normalizeCompany(r.companyName),
  }));
}

function findFuzzyMatch(
  existing: ExistingAccount[],
  companyNormalized: string,
  phone: string | null,
): ExistingAccount | null {
  // Same phone + reasonably close name wins
  if (phone) {
    const phoneHits = existing.filter((a) => a.phone === phone);
    for (const hit of phoneHits) {
      if (hit.companyNormalized === companyNormalized) return hit;
      const dist = levenshtein.get(hit.companyNormalized, companyNormalized);
      const len = Math.max(hit.companyNormalized.length, companyNormalized.length, 1);
      if (dist / len <= 0.2) return hit;
    }
  }
  // Otherwise: exact normalized name match
  const exact = existing.find((a) => a.companyNormalized === companyNormalized);
  return exact ?? null;
}

async function getPricing() {
  const [row] = await db.select().from(servicePricingConfig).limit(1);
  const ff = row ? Number(row.ffPerFryerPerMonth) : 300;
  const fs_ = row ? Number(row.fsPerQuarter) : 750;
  return { ffPerFryerPerMonth: ff, fsPerQuarter: fs_ };
}

async function ensureFfOpportunity(accountId: string, fryerCount: number, stage: PipelineStage) {
  const existing = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.accountId, accountId), eq(opportunities.serviceType, "ff")))
    .limit(1);
  if (existing.length) return;
  const { ffPerFryerPerMonth } = await getPricing();
  const annual = (fryerCount * ffPerFryerPerMonth * 12).toFixed(2);
  await db.insert(opportunities).values({
    accountId,
    name: `FiltaFry — ${fryerCount} fryer${fryerCount === 1 ? "" : "s"}`,
    serviceType: "ff",
    stage,
    estimatedValueAnnual: annual,
  });
}

async function main() {
  if (!fs.existsSync(LEADS_CSV)) {
    console.error(`Leads CSV not found at ${LEADS_CSV}`);
    console.error("Set LEADS_CSV=/absolute/path/to/filta_symphony_leads.csv");
    process.exit(1);
  }

  const raw = fs.readFileSync(LEADS_CSV);
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as LeadRow[];

  console.log(`Parsed ${rows.length} rows from ${path.basename(LEADS_CSV)}`);

  const territoryLookup = await loadTerritoryLookup();
  const existing = await loadExistingAccounts();

  const unknownCities = new Set<string>();
  const unknownFunnel = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const company = (row.Company ?? "").trim();
    if (!company) {
      skipped += 1;
      continue;
    }

    const companyNormalized = normalizeCompany(company);
    const phone = normalizePhone(row.Phone);
    const cityRaw = (row.City ?? "").trim();
    const cityNorm = normalizeCity(cityRaw);
    const terr = cityNorm ? territoryLookup.get(cityNorm) : undefined;
    if (cityNorm && !terr) unknownCities.add(cityRaw);

    const stage = mapSalesFunnel(row["Sales Funnel"]);
    if (row["Sales Funnel"] && !(row["Sales Funnel"].trim() in SALES_FUNNEL_MAP)) {
      unknownFunnel.add(row["Sales Funnel"].trim());
    }

    const nca = detectNca(row.NCA ?? "", company);
    const fryerCount = parseFryerCount(row.Fryers);
    const filtaRecordId = (row["Record ID"] ?? "").trim() || null;

    // Match by filta_record_id → phone+name fuzzy → name exact
    let match: ExistingAccount | null = null;
    if (filtaRecordId) {
      match = existing.find((a) => a.filtaRecordId === filtaRecordId) ?? null;
    }
    if (!match) match = findFuzzyMatch(existing, companyNormalized, phone);

    const baseValues = {
      companyName: company,
      city: cityRaw || null,
      county: terr?.county ?? null,
      territory: terr?.territory ?? ("unassigned" as const),
      phone,
      phoneRaw: row.Phone?.trim() || null,
      fryerCount,
      ncaFlag: nca.flag,
      ncaName: nca.name,
      filtaRecordId,
    };

    let accountId: string;
    if (match) {
      await db
        .update(accounts)
        .set({ ...baseValues, updatedAt: new Date() })
        .where(eq(accounts.id, match.id));
      accountId = match.id;
      updated += 1;
    } else {
      const [row2] = await db
        .insert(accounts)
        .values({
          ...baseValues,
          accountStatus: "prospect",
          leadSource: "filta_corporate",
        })
        .returning({ id: accounts.id });
      accountId = row2.id;
      existing.push({
        id: accountId,
        companyName: company,
        companyNormalized,
        phone,
        filtaRecordId,
      });
      inserted += 1;
    }

    // Contact (primary) from 'Contact' column
    const { firstName, lastName, fullName } = splitContactName(row.Contact);
    if (fullName) {
      const existingContact = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.accountId, accountId), eq(contacts.fullName, fullName)))
        .limit(1);
      if (!existingContact.length) {
        await db.insert(contacts).values({
          accountId,
          firstName,
          lastName,
          fullName,
          isPrimary: true,
        });
      }
    }

    // Auto-create FF opportunity when fryer count is known
    if (fryerCount && fryerCount > 0) {
      await ensureFfOpportunity(accountId, fryerCount, stage);
    }
  }

  console.log(`Import summary:`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  if (unknownCities.size) {
    console.log(
      `  Unknown cities (${unknownCities.size}): ${[...unknownCities]
        .slice(0, 20)
        .join(", ")}${unknownCities.size > 20 ? ", ..." : ""}`,
    );
  }
  if (unknownFunnel.size) {
    console.log(
      `  Unknown Sales Funnel values (${unknownFunnel.size}): ${[
        ...unknownFunnel,
      ].join(", ")}`,
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
