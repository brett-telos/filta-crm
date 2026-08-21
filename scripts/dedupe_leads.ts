// scripts/dedupe_leads.ts — find and merge duplicate lead/customer accounts.
//
// Why: the Feb 2026 Symphony import re-landed leads that already existed from
// the 2013-2024 vintage data (same business, new record id), so the account
// universe carries twins. Duplicates don't break the app, but a rep can
// dictate notes into the wrong twin, so we merge the provable ones and put
// the judgment calls in front of a human.
//
// Usage (Replit shell):
//   npm run dedupe -- --analyze
//       Writes dedupe_auto_plan.csv (what --apply would merge) and
//       dedupe_review.csv (human-judgment cases). Changes NOTHING.
//   npm run dedupe -- --apply
//       Performs the AUTO-tier merges in transactions.
//   npm run dedupe -- --apply --approved dedupe_review.csv
//       Also merges review rows whose Action column was set to "merge".
//   Add --limit 10 to any apply to do a small test batch first.
//
// Tiers:
//   AUTO   — same normalized phone AND (names similar OR same contact name),
//            OR same normalized name AND same normalized street address.
//            Skipped (demoted to REVIEW) if BOTH records are customers.
//   REVIEW — same contact name with different phones; same phone but names
//            not similar; same normalized name but different phone AND
//            different address (chain pattern — usually NOT a duplicate).
//
// Merge semantics (per group, one transaction):
//   - Survivor = highest score: customer beats prospect, then activity
//     count, then funnel-stage rank, then filled-field count, then newest.
//   - Loser's activities/contacts/opportunities/tasks/email_sends/
//     service_agreements are repointed to the survivor.
//   - Survivor's empty scalar fields are filled from the loser (phone,
//     address, website, fryer_count, nca, contact info comes via contacts).
//   - Loser is SOFT-deleted (deleted_at = now()) and its Symphony record id
//     + name are appended to the survivor's notes for traceability. Nothing
//     is ever hard-deleted; a merge is reversible by hand.
//   - A 'note' activity documents the merge on the survivor's timeline.

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const AUTO = "AUTO";
const REVIEW = "REVIEW";

type Acct = {
  id: string;
  company_name: string;
  address_line_1: string | null;
  city: string | null;
  zip: string | null;
  territory: string;
  phone: string | null;
  phone_raw: string | null;
  website: string | null;
  fryer_count: number | null;
  account_status: string;
  sales_funnel_stage: string;
  nca_flag: boolean;
  nca_name: string | null;
  filta_record_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  activity_count: number;
  opp_count: number;
  contact_names: string[]; // lowercased full names
};

// --------------------------------------------------------------------------
// Normalizers (same spirit as lib/billing-csv normalizeCompany — duplicated
// here so the script stays runnable standalone via tsx without the Next
// path aliases).
// --------------------------------------------------------------------------

function normName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(LLC|INC|CORP|CO|COMPANY|LTD|LP|LLP|THE|OF|RESTAURANT|RSTRNT|BAR|GRILL|GRILLE)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normPhone(p: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function normAddr(a: string | null): string {
  if (!a) return "";
  return a
    .toUpperCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|DRIVE|DR|ROAD|RD|HIGHWAY|HWY|SUITE|STE|UNIT|N|S|E|W|NORTH|SOUTH|EAST|WEST)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normContact(c: string): string {
  return c.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Levenshtein distance, small-string implementation. */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function namesSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  const d = lev(a, b);
  return d <= Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.2));
}

/** Contact names too generic to trust as an identity signal on their own. */
function contactUsable(c: string): boolean {
  if (!c) return false;
  const parts = c.split(" ");
  return c.length >= 6 && parts.length >= 2; // require first + last
}

const STAGE_RANK: Record<string, number> = {
  new_lead: 0, contacted: 1, qualified: 2, proposal: 3,
  negotiation: 4, closed_lost: 1, closed_won: 5,
};

function score(a: Acct): number {
  let s = 0;
  if (a.account_status === "customer") s += 10_000;
  s += a.activity_count * 100;
  s += a.opp_count * 50;
  s += (STAGE_RANK[a.sales_funnel_stage] ?? 0) * 10;
  for (const f of [a.phone, a.address_line_1, a.website, a.fryer_count, a.filta_record_id]) {
    if (f !== null && f !== "") s += 2;
  }
  s += a.updated_at.getTime() / 1e13; // tiny recency tiebreak
  return s;
}

// --------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Pair = {
  tier: string;
  reason: string;
  survivor: Acct;
  loser: Acct;
};

async function main() {
  const args = process.argv.slice(2);
  const analyze = args.includes("--analyze");
  const apply = args.includes("--apply");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const approvedIdx = args.indexOf("--approved");
  const approvedPath = approvedIdx >= 0 ? args[approvedIdx + 1] : null;

  if (!analyze && !apply) {
    console.log("Pass --analyze (dry run, writes CSVs) or --apply (merge AUTO tier).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query<Acct>(`
    SELECT a.id, a.company_name, a.address_line_1, a.city, a.zip, a.territory,
           a.phone, a.phone_raw, a.website, a.fryer_count, a.account_status,
           a.sales_funnel_stage, a.nca_flag, a.nca_name, a.filta_record_id,
           a.notes, a.created_at, a.updated_at,
           COALESCE(act.n, 0)::int AS activity_count,
           COALESCE(opp.n, 0)::int AS opp_count,
           COALESCE(con.names, '{}') AS contact_names
    FROM accounts a
    LEFT JOIN LATERAL (SELECT count(*) n FROM activities WHERE account_id = a.id) act ON true
    LEFT JOIN LATERAL (SELECT count(*) n FROM opportunities WHERE account_id = a.id AND deleted_at IS NULL) opp ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(lower(coalesce(full_name, first_name || ' ' || last_name))) names
      FROM contacts WHERE account_id = a.id AND deleted_at IS NULL
    ) con ON true
    WHERE a.deleted_at IS NULL
  `);

  console.log(`Loaded ${rows.length} live accounts.`);

  // Precompute keys.
  const enriched = rows.map((a) => ({
    a,
    nName: normName(a.company_name),
    nPhone: normPhone(a.phone_raw ?? a.phone),
    nAddr: normAddr(a.address_line_1),
    nContacts: (a.contact_names ?? []).filter(Boolean).map(normContact).filter(contactUsable),
  }));

  // Candidate pairs via blocking on phone, name, and contact.
  const byPhone = new Map<string, typeof enriched>();
  const byName = new Map<string, typeof enriched>();
  const byContact = new Map<string, typeof enriched>();
  for (const e of enriched) {
    if (e.nPhone) (byPhone.get(e.nPhone) ?? byPhone.set(e.nPhone, []).get(e.nPhone)!).push(e);
    if (e.nName) (byName.get(e.nName) ?? byName.set(e.nName, []).get(e.nName)!).push(e);
    for (const c of e.nContacts) {
      (byContact.get(c) ?? byContact.set(c, []).get(c)!).push(e);
    }
  }

  const seen = new Set<string>();
  const pairs: Pair[] = [];

  function classify(x: (typeof enriched)[number], y: (typeof enriched)[number]) {
    const key = [x.a.id, y.a.id].sort().join("|");
    if (seen.has(key) || x.a.id === y.a.id) return;
    seen.add(key);

    const samePhone = !!x.nPhone && x.nPhone === y.nPhone;
    const nameSim = namesSimilar(x.nName, y.nName);
    const sameAddr = !!x.nAddr && x.nAddr === y.nAddr && !!x.a.city && x.a.city === y.a.city;
    const sameContact = x.nContacts.some((c) => y.nContacts.includes(c));

    let tier: string | null = null;
    let reason = "";
    if (samePhone && (nameSim || sameContact)) {
      tier = AUTO;
      reason = `same phone + ${nameSim ? "similar name" : "same contact"}`;
    } else if (nameSim && sameAddr) {
      tier = AUTO;
      reason = "same name + same address";
    } else if (sameContact) {
      tier = REVIEW;
      reason = "same contact, different phone";
    } else if (samePhone) {
      tier = REVIEW;
      reason = "same phone, names differ";
    } else if (x.nName === y.nName && x.nName.length >= 4) {
      tier = REVIEW;
      reason = "same name, different phone/address (chain? usually keep both)";
    }
    if (!tier) return;

    // Two live CUSTOMERS merging is a billing question, not a script's call.
    if (tier === AUTO && x.a.account_status === "customer" && y.a.account_status === "customer") {
      tier = REVIEW;
      reason += " [both are customers — confirm by hand]";
    }

    const [survivor, loser] =
      score(x.a) >= score(y.a) ? [x.a, y.a] : [y.a, x.a];
    pairs.push({ tier, reason, survivor, loser });
  }

  for (const bucket of [...byPhone.values(), ...byName.values(), ...byContact.values()]) {
    if (bucket.length < 2 || bucket.length > 120) continue;
    for (let i = 0; i < bucket.length; i++)
      for (let j = i + 1; j < bucket.length; j++) classify(bucket[i], bucket[j]);
  }
  // Similar-but-not-equal names within same city (small n² per city is fine
  // at this data size).
  const byCity = new Map<string, typeof enriched>();
  for (const e of enriched) {
    const c = (e.a.city ?? "").toUpperCase().trim();
    if (!c) continue;
    (byCity.get(c) ?? byCity.set(c, []).get(c)!).push(e);
  }
  for (const bucket of byCity.values()) {
    for (let i = 0; i < bucket.length; i++)
      for (let j = i + 1; j < bucket.length; j++) {
        if (namesSimilar(bucket[i].nName, bucket[j].nName)) classify(bucket[i], bucket[j]);
      }
  }

  const auto = pairs.filter((p) => p.tier === AUTO);
  const review = pairs.filter((p) => p.tier === REVIEW);
  console.log(`Candidate pairs: ${pairs.length} (AUTO ${auto.length}, REVIEW ${review.length})`);

  const header = [
    "Action", "Tier", "Reason",
    "Survivor Company", "Survivor City", "Survivor Phone", "Survivor Stage", "Survivor Status", "Survivor Activities", "Survivor Symphony ID", "Survivor DB ID",
    "Loser Company", "Loser City", "Loser Phone", "Loser Stage", "Loser Status", "Loser Activities", "Loser Symphony ID", "Loser DB ID",
  ];
  const toRow = (p: Pair, action: string) =>
    [
      action, p.tier, p.reason,
      p.survivor.company_name, p.survivor.city, p.survivor.phone_raw ?? p.survivor.phone, p.survivor.sales_funnel_stage, p.survivor.account_status, p.survivor.activity_count, p.survivor.filta_record_id, p.survivor.id,
      p.loser.company_name, p.loser.city, p.loser.phone_raw ?? p.loser.phone, p.loser.sales_funnel_stage, p.loser.account_status, p.loser.activity_count, p.loser.filta_record_id, p.loser.id,
    ].map(csvCell).join(",");

  if (analyze) {
    fs.writeFileSync(
      "dedupe_auto_plan.csv",
      [header.join(","), ...auto.map((p) => toRow(p, "merge"))].join("\n"),
    );
    fs.writeFileSync(
      "dedupe_review.csv",
      [header.join(","), ...review.map((p) => toRow(p, ""))].join("\n"),
    );
    console.log("Wrote dedupe_auto_plan.csv and dedupe_review.csv. Nothing was changed.");
    console.log('Review flow: fill the Action column with "merge" (or "swap" to merge the other direction, or leave blank to keep both), then run:');
    console.log("  npm run dedupe -- --apply --approved dedupe_review.csv");
    await pool.end();
    return;
  }

  // ------------------------------ APPLY ---------------------------------
  const toMerge: Pair[] = [...auto];
  if (approvedPath) {
    const text = fs.readFileSync(path.resolve(approvedPath), "utf8");
    const lines = text.split(/\r?\n/).slice(1).filter(Boolean);
    const wanted = new Map<string, string>(); // "survivorId|loserId" -> action
    for (const line of lines) {
      // naive CSV split is fine here: the two ID columns we need are UUIDs
      // (never quoted/comma'd) at fixed positions from the END of the row.
      const cells = line.match(/(".*?"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
      const action = (cells[0] ?? "").trim().toLowerCase();
      if (action !== "merge" && action !== "swap") continue;
      const survivorId = cells[10];
      const loserId = cells[18];
      if (survivorId && loserId) wanted.set(`${survivorId}|${loserId}`, action);
    }
    for (const p of review) {
      const act = wanted.get(`${p.survivor.id}|${p.loser.id}`);
      if (act === "merge") toMerge.push(p);
      else if (act === "swap") toMerge.push({ ...p, survivor: p.loser, loser: p.survivor });
    }
    console.log(`Approved review merges: ${toMerge.length - auto.length}`);
  }

  // A record can appear in several pairs; process serially, re-checking
  // deleted_at so an already-merged loser is skipped, and following a
  // survivor that itself got merged earlier in this run.
  const mergedInto = new Map<string, string>();
  let done = 0;
  const client = await pool.connect();
  try {
    for (const p of toMerge) {
      if (done >= limit) break;
      let survivorId = p.survivor.id;
      while (mergedInto.has(survivorId)) survivorId = mergedInto.get(survivorId)!;
      const loserId = p.loser.id;
      if (mergedInto.has(loserId) || survivorId === loserId) continue;

      await client.query("BEGIN");
      try {
        const { rows: [loser] } = await client.query(
          "SELECT * FROM accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
          [loserId],
        );
        const { rows: [survivor] } = await client.query(
          "SELECT * FROM accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
          [survivorId],
        );
        if (!loser || !survivor) {
          await client.query("ROLLBACK");
          continue;
        }

        for (const table of [
          "activities", "contacts", "opportunities", "tasks",
          "email_sends", "service_agreements",
        ]) {
          await client.query(
            `UPDATE ${table} SET account_id = $1 WHERE account_id = $2`,
            [survivorId, loserId],
          );
        }

        // Fill survivor gaps from the loser.
        await client.query(
          `UPDATE accounts SET
             phone          = COALESCE(phone, $2),
             phone_raw      = COALESCE(phone_raw, $3),
             address_line_1 = COALESCE(address_line_1, $4),
             city           = COALESCE(city, $5),
             zip            = COALESCE(zip, $6),
             county         = COALESCE(county, $7),
             website        = COALESCE(website, $8),
             fryer_count    = COALESCE(fryer_count, $9),
             nca_flag       = (nca_flag OR $10),
             nca_name       = COALESCE(nca_name, $11),
             notes          = TRIM(BOTH E'\n' FROM COALESCE(notes, '') || E'\n' ||
                              '[merged ' || to_char(now(), 'MM/DD/YY') || ': ' || $12 ||
                              COALESCE(' · Symphony ID ' || $13, '') || ']'),
             updated_at     = now()
           WHERE id = $1`,
          [
            survivorId, loser.phone, loser.phone_raw, loser.address_line_1,
            loser.city, loser.zip, loser.county, loser.website,
            loser.fryer_count, loser.nca_flag, loser.nca_name,
            loser.company_name, loser.filta_record_id,
          ],
        );

        await client.query(
          `INSERT INTO activities (account_id, type, direction, subject, body)
           VALUES ($1, 'note', 'na', 'Merged duplicate record',
                   'Absorbed duplicate "' || $2 || '"' ||
                   COALESCE(' (Symphony ID ' || $3 || ')', '') ||
                   ' — ' || $4 || '. Its history now lives on this timeline.')`,
          [survivorId, loser.company_name, loser.filta_record_id, p.reason],
        );

        await client.query(
          "UPDATE accounts SET deleted_at = now(), updated_at = now() WHERE id = $1",
          [loserId],
        );

        await client.query("COMMIT");
        mergedInto.set(loserId, survivorId);
        done++;
        console.log(`merged: "${loser.company_name}" → "${survivor.company_name}" (${p.reason})`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`FAILED pair ${survivorId} ← ${loserId}:`, err);
      }
    }
  } finally {
    client.release();
  }

  console.log(`Done. Merged ${done} duplicate(s). Losers are soft-deleted (deleted_at), nothing was hard-deleted.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
