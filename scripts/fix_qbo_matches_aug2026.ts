// scripts/fix_qbo_matches_aug2026.ts — one-time cleanup after the Aug 2026
// QBO billing import review.
//
// What the LOOSE_MATCH run got wrong (by Brett's review, Aug 19 2026):
//   1. Jimmy Hula's: three locations (New Smyrna Beach, Ormond Beach,
//      Port Orange) summed onto one bare "Jimmy Hula's" account. Decision:
//      per-location accounts.
//   2. Halifax Health: Deltona + France Tower + Main Kitchen summed onto the
//      umbrella "Halifax Health" account. Decision: split into three kitchen
//      accounts, matching how QBO bills.
//   3. Northrop Grumman: mapped to "Northrop Grumman - Vending - CLOSING",
//      which is the wrong record. Decision: fresh "Northrop Grumman" account.
//   4. "Canteen-Embraer Aircraft - 61902" never matched (no account exists).
//
// What this script does (idempotent, safe to re-run):
//   a. Creates the canonical accounts below if no exact-name account exists.
//      It does NOT rename or merge look-alike variants — run the dedupe tool
//      afterwards to fold any old variant records into these.
//   b. Clears the QBO-written ff/fs/fg/fd off the three mis-targeted
//      accounts (bare "Jimmy Hula's", "Halifax Health", the Northrop CLOSING
//      record), preserving the Symphony-sourced fb flag, and drops a note
//      activity on each explaining why.
//   c. Prints candidate look-alike accounts for each target so you can feed
//      the dedupe review with eyes open.
//
// AFTER running this, re-run WITHOUT loose mode:
//   npm run import:billing:qbo
// The import script's QBO_NAME_OVERRIDES (added in the same commit) routes
// each QBO row to its canonical account by exact name, so the revenue lands
// on the right records and strict mode stays sufficient going forward.

import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import { accounts, activities, db, pool } from "../src/db";

type NewAcct = {
  name: string;
  city: string;
  county: string;
  territory: "fun_coast" | "space_coast";
  searchHint: string; // ilike pattern for candidate reporting
};

const CREATE: NewAcct[] = [
  { name: "Jimmy Hula's - New Smyrna Beach", city: "New Smyrna Beach", county: "Volusia", territory: "fun_coast", searchHint: "%jimmy hula%" },
  { name: "Jimmy Hula's - Ormond Beach", city: "Ormond Beach", county: "Volusia", territory: "fun_coast", searchHint: "%jimmy hula%" },
  { name: "Jimmy Hula's - Port Orange", city: "Port Orange", county: "Volusia", territory: "fun_coast", searchHint: "%jimmy hula%" },
  { name: "Halifax Health - Deltona", city: "Deltona", county: "Volusia", territory: "fun_coast", searchHint: "%halifax%" },
  { name: "Halifax Health - France Tower", city: "Daytona Beach", county: "Volusia", territory: "fun_coast", searchHint: "%halifax%" },
  { name: "Halifax Health - Main Kitchen", city: "Daytona Beach", county: "Volusia", territory: "fun_coast", searchHint: "%halifax%" },
  { name: "Northrop Grumman", city: "Melbourne", county: "Brevard", territory: "space_coast", searchHint: "%northrop%" },
  { name: "Canteen-Embraer", city: "Melbourne", county: "Brevard", territory: "space_coast", searchHint: "%embraer%" },
];

/** Accounts whose QBO-written service revenue must be cleared because the
 *  loose run put another location's (or entity's) revenue on them. */
const CLEAR_PROFILE_OF = [
  "Jimmy Hula's",
  "Halifax Health",
  "Northrop Grumman - Vending - CLOSING",
];

async function main() {
  // ---- a. create canonical accounts --------------------------------------
  for (const c of CREATE) {
    const [existing] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyName, c.name), isNull(accounts.deletedAt)))
      .limit(1);
    if (existing) {
      console.log(`exists:  ${c.name}`);
    } else {
      await db.insert(accounts).values({
        companyName: c.name,
        city: c.city,
        state: "FL",
        county: c.county,
        territory: c.territory,
        accountStatus: "prospect", // the QBO import flips to customer on revenue
        leadSource: "other",
        notes:
          "Created 8/19/26 by fix_qbo_matches_aug2026 so QBO billing lands per-location. " +
          "If an older variant record exists for this location, merge it into this one with npm run dedupe.",
      });
      console.log(`created: ${c.name} (${c.city}, ${c.territory})`);
    }
  }

  // ---- c. report look-alikes for the dedupe review ----------------------
  console.log("\nLook-alike candidates (feed these to the dedupe review):");
  const hints = Array.from(new Set(CREATE.map((c) => c.searchHint)));
  for (const hint of hints) {
    const rows = await db
      .select({ name: accounts.companyName, city: accounts.city, status: accounts.accountStatus })
      .from(accounts)
      .where(and(ilike(accounts.companyName, hint), isNull(accounts.deletedAt)));
    for (const r of rows) console.log(`  [${hint}] ${r.name} (${r.city ?? "?"}, ${r.status})`);
  }

  // ---- b. clear mis-landed QBO revenue -----------------------------------
  for (const name of CLEAR_PROFILE_OF) {
    const [acct] = await db
      .select({ id: accounts.id, profile: accounts.serviceProfile })
      .from(accounts)
      .where(and(eq(accounts.companyName, name), isNull(accounts.deletedAt)))
      .limit(1);
    if (!acct) {
      console.log(`clear:   "${name}" not found (already handled?) — skipped`);
      continue;
    }
    const p = { ...(acct.profile as Record<string, unknown>) };
    const hadQboKeys = ["ff", "fs", "fg", "fd"].some((k) => k in p);
    for (const k of ["ff", "fs", "fg", "fd"]) delete p[k]; // fb & others survive
    if (!hadQboKeys) {
      console.log(`clear:   ${name} — nothing to clear`);
      continue;
    }
    await db
      .update(accounts)
      .set({ serviceProfile: p, updatedAt: new Date() })
      .where(eq(accounts.id, acct.id));
    await db.insert(activities).values({
      accountId: acct.id,
      type: "note",
      direction: "na",
      subject: "QBO billing reassigned",
      body:
        "The Aug 2026 loose-match import placed another location's QBO revenue on this record. " +
        "Cleared here and reassigned to the correct per-location account(s). " +
        "See scripts/fix_qbo_matches_aug2026.ts.",
    });
    console.log(`cleared: ${name} (ff/fs/fg/fd removed, fb preserved)`);
  }

  console.log(
    "\nDone. Now run:  npm run import:billing:qbo   (strict mode — no LOOSE_MATCH needed)",
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
