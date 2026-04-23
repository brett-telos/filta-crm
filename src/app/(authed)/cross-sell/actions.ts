"use server";

// One-click "Create FiltaClean opportunity" for the cross-sell list. We pull
// the account's FF monthly revenue as a proxy for deal size (FS ballpark =
// FF monthly × 4, which is ~1/3 the annual FF revenue — matches the rough
// ratio we saw across the 5 current FS customers). The sales rep can override
// the estimated value on the opp detail page once we build that.

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accounts, opportunities, withSession } from "@/db";
import { requireSession } from "@/lib/session";

const Input = z.object({
  accountId: z.string().uuid(),
});

export type CreateFsResult = {
  ok: boolean;
  error?: string;
  opportunityId?: string;
};

// Ballpark: FS annual = FF monthly × 4. Tune after first wins.
const FS_ESTIMATE_MULTIPLIER = 4;

export async function createFsOpportunityAction(
  input: z.infer<typeof Input>,
): Promise<CreateFsResult> {
  const session = await requireSession();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  // Run the entire read-check-insert flow inside one RLS-bound transaction so
  // that a cross-territory insert is rejected by the DB even if the explicit
  // check below is bypassed.
  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.accountId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return { ok: false, error: "Account not found" };

    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    // Idempotency: if there's already an open FS opp, return it rather than
    // creating a duplicate.
    const existing = await tx
      .select({ id: opportunities.id, stage: opportunities.stage })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.accountId, acct.id),
          eq(opportunities.serviceType, "fs"),
          isNull(opportunities.deletedAt),
        ),
      );

    const openExisting = existing.find(
      (e) => e.stage !== "closed_won" && e.stage !== "closed_lost",
    );
    if (openExisting) {
      return { ok: true, opportunityId: openExisting.id };
    }

    const sp = (acct.serviceProfile as Record<string, any>) ?? {};
    const ffMonthly = Number(sp?.ff?.monthly_revenue ?? 0);
    const estimate = ffMonthly > 0 ? ffMonthly * FS_ESTIMATE_MULTIPLIER : null;

    const [inserted] = await tx
      .insert(opportunities)
      .values({
        accountId: acct.id,
        name: `${acct.companyName} — FiltaClean`,
        serviceType: "fs",
        stage: "new_lead",
        estimatedValueAnnual: estimate ? estimate.toFixed(2) : null,
        ownerUserId: acct.ownerUserId ?? session.sub,
      })
      .returning({ id: opportunities.id });

    revalidatePath("/cross-sell");
    revalidatePath("/pipeline");
    revalidatePath(`/accounts/${acct.id}`);

    return { ok: true, opportunityId: inserted.id };
  });
}
