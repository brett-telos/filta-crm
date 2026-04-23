// Seeds reference data: city/county/territory mapping, service pricing,
// known competitors, and a first admin user. Idempotent — safe to re-run.
import bcrypt from "bcryptjs";
import {
  db,
  pool,
  cityCountyMapping,
  servicePricingConfig,
  knownCompetitors,
  users,
} from "../index";
import { CITY_MAPPINGS } from "./cities";

async function seedCities() {
  console.log(`Seeding ${CITY_MAPPINGS.length} cities...`);
  for (const row of CITY_MAPPINGS) {
    await db
      .insert(cityCountyMapping)
      .values({
        cityNormalized: row.city.toUpperCase().trim(),
        cityDisplay: row.city,
        county: row.county,
        territory: row.territory,
      })
      .onConflictDoNothing();
  }
  console.log("  Cities seeded.");
}

async function seedPricing() {
  await db
    .insert(servicePricingConfig)
    .values({
      id: 1,
      ffPerFryerPerMonth: "300.00",
      fsPerQuarter: "750.00",
    })
    .onConflictDoNothing();
  console.log("Service pricing seeded (FF: $300/fryer/mo, FS: $750/qtr).");
}

async function seedCompetitors() {
  const competitors = [
    {
      name: "Restaurant Technologies",
      aliases: ["RTI", "Restaurant Technologies Inc", "Restaurant Tech"],
    },
    // Populate others as they come up
  ];
  for (const c of competitors) {
    await db.insert(knownCompetitors).values(c).onConflictDoNothing();
  }
  console.log("Known competitors seeded.");
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("Skipping admin seed (SEED_ADMIN_EMAIL/PASSWORD not set).");
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await db
    .insert(users)
    .values({
      email,
      passwordHash: hash,
      firstName: process.env.SEED_ADMIN_FIRST_NAME ?? "Admin",
      lastName: process.env.SEED_ADMIN_LAST_NAME ?? "User",
      role: "admin",
      territory: "both",
    })
    .onConflictDoNothing();
  console.log(`Admin user seeded: ${email}`);
}

async function main() {
  await seedCities();
  await seedPricing();
  await seedCompetitors();
  await seedAdmin();
  await pool.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
