// Apply the RLS policies defined in rls.sql. Idempotent — safe to re-run.
// Run via `npm run db:rls`.
//
// The script uses the system (un-bound) connection, so it bypasses RLS and
// is allowed to create policies on tables it owns.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL required");

  const sqlPath = resolve(process.cwd(), "src/db/rls.sql");
  const sqlText = await readFile(sqlPath, "utf8");

  const pool = new Pool({ connectionString });
  try {
    console.log("Applying RLS policies from src/db/rls.sql...");
    await pool.query(sqlText);
    console.log("RLS applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
