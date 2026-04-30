// One-shot backfill: create cross-sell pipeline opportunities for every
// customer account that doesn't already have an active service in
// FS / FB / FG / FC / FD.
//
// The leads importer only ever creates FF opportunities, so the pipeline
// kanban's per-service tabs were ~empty. This populates those columns
// with real, account-linked opportunities so the kanban filter is
// actually useful.
//
// Idempotent: re-running won't double-create. Skips a service for an
// account when:
//   - the account already has that service active in service_profile, OR
//   - the account already has an OPEN opportunity for that service
//     (any stage other than closed_won / closed_lost).
//
// Usage:
//   npm run backfill:crosssell                    # all customers, all services
//   ONLY=fs,fg npm run backfill:crosssell         # restrict to listed services
//   DRY_RUN=1 npm run backfill:crosssell          # log only, don't insert

import { and, eq, isNull } from "drizzle-orm";
import { db, pool, accounts, opportunities } from "../src/db";

type Service = "fs" | "fb" | "fg" | "fc" | "fd";

// Annual estimated value formulas. ffMonthly = the customer's current
// monthly FiltaFry revenue from billing — a strong proxy for site size.
//   - FS (FiltaClean):  ~4x FF monthly  (existing FS_ESTIMATE_MULTIPLIER)
//   - FG (FiltaGold):   ~6x FF monthly  (deep clean, premium pricing)
//   - FD (FiltaDrain):  ~0.5x FF monthly (small recurring add-on)
//   - FB (FiltaBio):    typically bundled / break-even — leave null
//   - FC (FiltaCool):   one-time install, varies wildly — leave null
function estimateAnnual(svc: Service, ffMonthly: number): string | null {
  if (svc === "fs" && ffMonthly > 0) return (ffMonthly * 4).toFixed(2);
  if (svc === "fg" && ffMonthly > 0) return (ffMonthly * 6).toFixed(2);
  if (svc === "fd" && ffMonthly > 0) return (ffMonthly * 0.5).toFixed(2);
  return null;
}

const SERVICE_DISPLAY: Record<Service, string> = {
  fs: "FiltaClean",
  fb: "FiltaBio",
  fg: "FiltaGold",
  fc: "FiltaCool",
  fd: "FiltaDrain",
};

const ALL_SERVICES: Service[] = ["fs", "fb", "fg", "fc", "fd"];

function parseOnlyEnv(): Service[] {
  const raw = process.env.ONLY;
  if (!raw) return ALL_SERVICES;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const services = parts.filter((s): s is Service =>
    (ALL_SERVICES as string[]).includes(s),
  );
  if (services.length === 0) {
    console.error(
      `ONLY=${raw} produced no valid services. Valid: ${ALL_SERVICES.join(",")}`,
    );
    process.exit(1);
  }
  return services;
}

const DRY_RUN = ((process.env.DRY_RUN ?? "").toLowerCase() === "1" ||
  (process.env.DRY_RUN ?? "").toLowerCase() === "true");

async function main() {
  const services = parseOnlyEnv();
  console.log(
    `Backfill cross-sell opportunities — services: [${services.join(", ")}]${
      DRY_RUN ? "  (DRY_RUN)" : ""
    }`,
  );

  // Pull every customer account with the fields we need. Territory is
  // not enforced here — this is a one-shot data backfill, not a
  // user-scoped action.
  const customers = await db
    .select({
      id: accounts.id,
      companyName: accounts.companyName,
      ownerUserId: accounts.ownerUserId,
      serviceProfile: accounts.serviceProfile,
    })
    .from(accounts)
    .where(
      and(eq(accounts.accountStatus, "customer"), isNull(accounts.deletedAt)),
    );

  console.log(`Found ${customers.length} customer accounts.`);

  // One round-trip to fetch all existing opportunities for those accounts,
  // then bucket by (accountId, serviceType) so we can skip duplicates
  // without N+1 queries.
  const existing = await db
    .select({
      accountId: opportunities.accountId,
      serviceType: opportunities.serviceType,
      stage: opportunities.stage,
      deletedAt: opportunities.deletedAt,
    })
    .from(opportunities);

  const openBy = new Map<string, true>(); // key = `${accountId}:${serviceType}`
  for (const o of existing) {
    if (o.deletedAt) continue;
    if (o.stage === "closed_won" || o.stage === "closed_lost") continue;
    openBy.set(`${o.accountId}:${o.serviceType}`, true);
  }

  const summary: Record<Service, { created: number; skippedActive: number; skippedExisting: number }> = {
    fs: { created: 0, skippedActive: 0, skippedExisting: 0 },
    fb: { created: 0, skippedActive: 0, skippedExisting: 0 },
    fg: { created: 0, skippedActive: 0, skippedExisting: 0 },
    fc: { created: 0, skippedActive: 0, skippedExisting: 0 },
    fd: { created: 0, skippedActive: 0, skippedExisting: 0 },
  };

  for (const acct of customers) {
    const sp = (acct.serviceProfile as Record<string, any>) ?? {};
    const ffMonthly = Number(sp?.ff?.monthly_revenue ?? 0);

    for (const svc of services) {
      // Already an active service on this account → nothing to sell.
      if (sp?.[svc]?.active === true) {
        summary[svc].skippedActive += 1;
        continue;
      }
      // Already an open opportunity → idempotent skip.
      if (openBy.has(`${acct.id}:${svc}`)) {
        summary[svc].skippedExisting += 1;
        continue;
      }

      const annual = estimateAnnual(svc, ffMonthly);
      const name = `${acct.companyName} — ${SERVICE_DISPLAY[svc]}`;

      if (DRY_RUN) {
        summary[svc].created += 1;
        continue;
      }

      await db.insert(opportunities).values({
        accountId: acct.id,
        name,
        serviceType: svc,
        stage: "new_lead",
        estimatedValueAnnual: annual,
        ownerUserId: acct.ownerUserId ?? null,
      });
      summary[svc].created += 1;
    }
  }

  console.log(`\nBackfill complete${DRY_RUN ? " (DRY_RUN — nothing written)" : ""}:`);
  console.log(
    `  ${"Service".padEnd(12)} ${"Created".padStart(8)} ${"Skip:Active".padStart(12)} ${"Skip:Existing".padStart(14)}`,
  );
  for (const svc of services) {
    const s = summary[svc];
    console.log(
      `  ${SERVICE_DISPLAY[svc].padEnd(12)} ${String(s.created).padStart(8)} ${String(s.skippedActive).padStart(12)} ${String(s.skippedExisting).padStart(14)}`,
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
