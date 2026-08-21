"use server";

// Move an opportunity to a new pipeline stage. Called from the Kanban board
// when the user drops a card on a column. Keeps stage_changed_at fresh for
// age-in-stage reporting, and enforces territory scoping (a Fun Coast rep
// can't move a Space Coast deal).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accounts, opportunities, withSession } from "@/db";
import { requireSession } from "@/lib/session";

const Input = z.object({
  opportunityId: z.string().uuid(),
  stage: z.enum([
    "new_lead",
    "contacted",
    "qualified",
    "proposal",
    "negotiation",
    "closed_won",
    "closed_lost",
  ]),
});

export type MoveResult = { ok: boolean; error?: string };

export async function moveOpportunityStageAction(
  input: z.infer<typeof Input>,
): Promise<MoveResult> {
  const session = await requireSession();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { opportunityId, stage } = parsed.data;

  // Both the lookup and the update run inside a single RLS-bound transaction.
  // The withSession wrapper sets app.user_* so the policies in rls.sql catch
  // any cross-territory attempt at the DB layer, even if the explicit check
  // below is ever removed or forgotten.
  return withSession(session, async (tx) => {
    const [row] = await tx
      .select({
        id: opportunities.id,
        accountTerritory: accounts.territory,
        currentStage: opportunities.stage,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .where(eq(opportunities.id, opportunityId))
      .limit(1);

    if (!row) return { ok: false, error: "Opportunity not found" };

    if (
      session.territory !== "both" &&
      row.accountTerritory !== session.territory &&
      row.accountTerritory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    if (row.currentStage === stage) return { ok: true };

    // Stamp stage_changed_at on every move (the updateAt trigger handles the
    // other timestamp). If we're dropping into closed_won/lost, also stamp
    // actual_close_date.
    const now = new Date();
    const isClosed = stage === "closed_won" || stage === "closed_lost";

    await tx
      .update(opportunities)
      .set({
        stage,
        stageChangedAt: now,
        updatedAt: now,
        ...(isClosed
          ? { actualCloseDate: now.toISOString().slice(0, 10) }
          : { actualCloseDate: null }),
      })
      .where(eq(opportunities.id, opportunityId));

    revalidatePath("/pipeline");
    return { ok: true };
  });
}
