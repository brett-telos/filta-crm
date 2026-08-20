// Database migration runner.
//
// Scans src/db/migrations/ for *.sql files, runs them in alphabetical order,
// tracks applied migrations in a `_migrations` table so reruns are no-ops.
// Replaces the Drizzle migrator we used briefly — we generate schema by
// hand in timestamped SQL files (and keep the original `0000`/`0001` Drizzle
// auto-gen files in place for the historical record). One tracking system,
// one runner, no surprises.
//
// Each migration file is expected to be idempotent on its own (uses
// `IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END$$`,
// etc.) so a partially-applied state is recoverable without manual surgery.
//
// Usage:
//   npm run db:migrate              -- apply every pending migration
//   npm run db:migrate -- --bootstrap
//                                   -- stamp every current file as applied
//                                      WITHOUT running it. Use exactly once
//                                      on a database that pre-existed this
//                                      tracking system (e.g. the running
//                                      Replit instance circa W5). After the
//                                      bootstrap, plain `db:migrate` only
//                                      runs new files.
//   npm run db:migrate -- --status
//                                   -- print which files are applied/pending
//                                      without running anything

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "src", "db", "migrations");

async function ensureTrackingTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function listMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".sql"))
    .map((d) => d.name)
    .sort();
}

async function listApplied(pool: Pool): Promise<Set<string>> {
  const res = await pool.query<{ name: string }>(
    `SELECT name FROM _migrations ORDER BY name`,
  );
  return new Set(res.rows.map((r) => r.name));
}

async function applyOne(pool: Pool, name: string, bootstrap: boolean) {
  const filepath = path.join(MIGRATIONS_DIR, name);
  if (bootstrap) {
    await pool.query(
      `INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`,
      [name],
    );
    console.log(`  ✓ stamped (not run): ${name}`);
    return;
  }
  console.log(`  → applying: ${name}`);
  const sql = fs.readFileSync(filepath, "utf-8");
  await pool.query(sql);
  await pool.query(
    `INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`,
    [name],
  );
  console.log(`  ✓ applied: ${name}`);
}

async function main() {
  const args = process.argv.slice(2);
  const bootstrap = args.includes("--bootstrap");
  const statusOnly = args.includes("--status");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL required");

  const pool = new Pool({ connectionString });
  try {
    await ensureTrackingTable(pool);

    const all = listMigrations();
    const applied = await listApplied(pool);
    const pending = all.filter((m) => !applied.has(m));

    if (statusOnly) {
      console.log(`Migrations on disk: ${all.length}`);
      console.log(`Applied: ${applied.size}`);
      console.log(`Pending: ${pending.length}`);
      if (pending.length > 0) {
        console.log("\nPending files:");
        for (const p of pending) console.log(`  - ${p}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    if (bootstrap) {
      console.log(
        `Bootstrap mode — stamping ${pending.length} file(s) as applied without running them:`,
      );
    } else {
      console.log(`Applying ${pending.length} pending migration(s):`);
    }
    for (const name of pending) {
      await applyOne(pool, name, bootstrap);
    }
    console.log("Migration complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
