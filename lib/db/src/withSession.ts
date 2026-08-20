// withSession(session, fn) — run a block of drizzle calls inside a
// transaction with the caller's identity bound to PG session variables.
// The RLS policies in rls.sql read those vars to decide what the caller
// can see and mutate.

import { sql } from "drizzle-orm";
import { db } from "./index";

export type SessionClaims = {
  sub: string; // user id
  email: string;
  firstName: string;
  role: "admin" | "sales_rep" | "technician";
  territory: "fun_coast" | "space_coast" | "both";
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withSession<T>(
  session: SessionClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // DATABASE_URL may use an owner/superuser role that bypasses RLS. Switch
    // every request-bound transaction into the restricted deployment role
    // before binding caller claims so FORCE ROW LEVEL SECURITY is effective.
    await tx.execute(sql`set local role filta_crm_runtime`);
    // set_config(key, value, is_local=true) == SET LOCAL: scoped to this tx.
    await tx.execute(sql`select set_config('app.user_id', ${session.sub}, true)`);
    await tx.execute(
      sql`select set_config('app.user_territory', ${session.territory}, true)`,
    );
    await tx.execute(sql`select set_config('app.user_role', ${session.role}, true)`);
    return fn(tx);
  });
}
