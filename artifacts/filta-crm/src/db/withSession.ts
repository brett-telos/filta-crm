// withSession(session, fn) — run a block of drizzle calls inside a
// transaction with the caller's identity bound to PG session variables.
// The RLS policies in rls.sql read those vars to decide what the caller
// can see and mutate.
//
// Usage:
//   const rows = await withSession(session, (tx) =>
//     tx.select().from(accounts).limit(20),
//   );
//
// If you forget to use this helper, queries still work — they run as
// "system" and bypass RLS (which is fine for existing queries that
// already apply in-code territory filters). Using withSession adds a
// DB-enforced safety net for any query that might slip past the manual
// filter.

import { sql } from "drizzle-orm";
import { db } from "./index";
import type { SessionClaims } from "@/lib/auth";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withSession<T>(
  session: SessionClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(key, value, is_local=true) == SET LOCAL: scoped to this tx.
    await tx.execute(sql`select set_config('app.user_id', ${session.sub}, true)`);
    await tx.execute(
      sql`select set_config('app.user_territory', ${session.territory}, true)`,
    );
    await tx.execute(sql`select set_config('app.user_role', ${session.role}, true)`);
    return fn(tx);
  });
}

// For raw `db.execute(sql``)` callers who want the same guarantees without
// restructuring into a transaction callback. Returns a function that wraps a
// single execute call.
export async function executeWithSession<T = unknown>(
  session: SessionClaims,
  query: ReturnType<typeof sql>,
): Promise<T> {
  return withSession(session, async (tx) => {
    const result = await tx.execute(query);
    return result as T;
  });
}
