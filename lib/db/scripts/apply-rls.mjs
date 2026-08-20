import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const RUNTIME_ROLE = "filta_crm_runtime";
const POLICY_SOURCE = new URL(
  "../../../artifacts/filta-crm/src/db/rls.sql",
  import.meta.url,
);
const PROTECTED_TABLES = [
  "accounts",
  "contacts",
  "opportunities",
  "activities",
  "users",
  "password_reset_tokens",
  "audit_log",
  "city_county_mapping",
  "service_pricing_config",
  "known_competitors",
];

async function verifyRls(client) {
  const tableState = await client.query(
    `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
      where relname = any($1::text[])`,
    [PROTECTED_TABLES],
  );

  const protectedTables = new Map(
    tableState.rows.map((row) => [
      row.relname,
      row.relrowsecurity && row.relforcerowsecurity,
    ]),
  );
  const missing = PROTECTED_TABLES.filter(
    (table) => protectedTables.get(table) !== true,
  );
  if (missing.length > 0) {
    throw new Error(
      `RLS verification failed for: ${missing.join(", ")}`,
    );
  }

  const policyCount = await client.query(
    `select count(*)::int as count
       from pg_policies
      where schemaname = current_schema()
        and tablename = any($1::text[])`,
    [PROTECTED_TABLES],
  );
  if ((policyCount.rows[0]?.count ?? 0) < PROTECTED_TABLES.length) {
    throw new Error("RLS verification found fewer policies than protected tables");
  }
}

async function verifyTerritoryIsolation(client) {
  for (const territory of ["fun_coast", "space_coast"]) {
    await client.query("begin");
    try {
      await client.query(`set local role ${RUNTIME_ROLE}`);
      await client.query(
        `select set_config('app.user_id', $1, true),
                set_config('app.user_territory', $2, true),
                set_config('app.user_role', 'sales_rep', true)`,
        ["00000000-0000-0000-0000-000000000000", territory],
      );
      const forbidden = await client.query(
        `select count(*)::int as count
           from accounts
          where territory::text not in ($1, 'unassigned')`,
        [territory],
      );
      if ((forbidden.rows[0]?.count ?? 0) !== 0) {
        throw new Error(
          `RLS territory verification exposed rows outside ${territory}`,
        );
      }
    } finally {
      await client.query("rollback");
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to apply RLS policies");
  }

  const sqlText = await readFile(POLICY_SOURCE, "utf8");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_roles where rolname = '${RUNTIME_ROLE}'
        ) then
          create role ${RUNTIME_ROLE}
            nologin noinherit nosuperuser nobypassrls;
        end if;
      end
      $$;

      alter role ${RUNTIME_ROLE}
        nologin noinherit nosuperuser nobypassrls;
      grant usage on schema public to ${RUNTIME_ROLE};
      grant select, insert, update, delete
        on all tables in schema public to ${RUNTIME_ROLE};
      grant usage, select
        on all sequences in schema public to ${RUNTIME_ROLE};
      alter default privileges in schema public
        grant select, insert, update, delete on tables to ${RUNTIME_ROLE};
      alter default privileges in schema public
        grant usage, select on sequences to ${RUNTIME_ROLE};
    `);
    console.log("Applying Filta CRM RLS policies...");
    await client.query(sqlText);
    await verifyRls(client);
    await verifyTerritoryIsolation(client);
    console.log("RLS policies applied and verified.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});