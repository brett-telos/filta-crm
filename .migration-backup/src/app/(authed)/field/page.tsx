// /field — Field Mode: the phone-first view for the sales team.
//
// The default list is the WORKING pipeline: prospects in contacted /
// qualified / proposal / negotiation, freshest first. That's what a rep
// scans between visits. The other ~5,000 imported new_lead rows are one
// search away (server-side, see searchLeadsAction) rather than shipped to
// the phone up front.

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { accounts, db, users } from "@/db";
import { requireSession } from "@/lib/session";
import FieldApp from "./FieldApp";
import type { FieldLeadRow } from "./actions";

export const dynamic = "force-dynamic";

export default async function FieldPage() {
  const session = await requireSession();

  const territoryWhere =
    session.territory === "both"
      ? undefined
      : or(
          eq(accounts.territory, session.territory),
          eq(accounts.territory, "unassigned"),
        );

  const rows = await db
    .select({
      id: accounts.id,
      companyName: accounts.companyName,
      city: accounts.city,
      territory: accounts.territory,
      stage: accounts.salesFunnelStage,
      stageChangedAt: accounts.salesFunnelStageChangedAt,
      phone: accounts.phone,
      phoneRaw: accounts.phoneRaw,
      accountStatus: accounts.accountStatus,
      fryerCount: accounts.fryerCount,
    })
    .from(accounts)
    .where(
      and(
        isNull(accounts.deletedAt),
        eq(accounts.accountStatus, "prospect"),
        inArray(accounts.salesFunnelStage, [
          "contacted",
          "qualified",
          "proposal",
          "negotiation",
        ]),
        territoryWhere,
      ),
    )
    .orderBy(desc(accounts.updatedAt))
    .limit(400);

  const leadRows: FieldLeadRow[] = rows.map((r) => ({
    ...r,
    stageChangedAt: r.stageChangedAt.toISOString(),
    lastActivityAt: null,
    lastActivityBody: null,
    ownerFirstName: null,
  }));

  const [me] = await db
    .select({ firstName: users.firstName })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);

  return (
    <FieldApp
      initialLeads={leadRows}
      userFirstName={me?.firstName ?? "there"}
    />
  );
}
