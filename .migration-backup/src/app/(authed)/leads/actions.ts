"use server";

// Server actions for /leads.
//
// moveLeadStageAction — drag-drop on the leads kanban moves an account's
// sales_funnel_stage. We also write a 'note' activity for the move so the
// account timeline records the funnel progression (a rep scrolling the
// timeline sees "moved to qualified by Dad on Apr 22" without us needing a
// separate lead_stage_events table).
//
// Territory scoping is enforced two ways:
//   1. Explicit check against session.territory + account.territory below.
//   2. The withSession() RLS-bound transaction (app.user_id) catches any
//      cross-territory attempt at the database layer.
//
// Conversion (prospect → customer) lives in convertLeadAction; it sets
// account_status='customer', stamps converted_at, marks the funnel stage
// closed_won, and writes a 'note' activity.

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accounts, activities, withSession } from "@/db";
import { requireSession } from "@/lib/session";

const FUNNEL_STAGES = [
  "new_lead",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

// ============================================================================
// MOVE STAGE
// ============================================================================

const MoveInput = z.object({
  accountId: z.string().uuid(),
  stage: z.enum(FUNNEL_STAGES),
});

export type MoveLeadStageResult = { ok: boolean; error?: string };

export async function moveLeadStageAction(
  input: z.infer<typeof MoveInput>,
): Promise<MoveLeadStageResult> {
  const session = await requireSession();
  const parsed = MoveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { accountId, stage } = parsed.data;

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({
        id: accounts.id,
        territory: accounts.territory,
        currentStage: accounts.salesFunnelStage,
        accountStatus: accounts.accountStatus,
        companyName: accounts.companyName,
      })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return { ok: false, error: "Lead not found" };

    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    // Only act on prospects. If a rep tries to drag a customer or churned
    // account on the leads board (shouldn't happen — they're not visible
    // there — but defense-in-depth), refuse with a clear error.
    if (acct.accountStatus !== "prospect") {
      return {
        ok: false,
        error: `Lead is no longer a prospect (status: ${acct.accountStatus})`,
      };
    }

    if (acct.currentStage === stage) return { ok: true };

    const now = new Date();
    await tx
      .update(accounts)
      .set({
        salesFunnelStage: stage,
        salesFunnelStageChangedAt: now,
        updatedAt: now,
      })
      .where(eq(accounts.id, accountId));

    // Audit row in the activity timeline. Using 'note' (instead of inventing
    // a new 'stage_change' type) keeps the activity_type enum stable and the
    // timeline UI rendering simple.
    await tx.insert(activities).values({
      accountId,
      type: "note",
      direction: "na",
      subject: `Funnel stage → ${stage}`,
      body: `Lead moved to '${stage}' on /leads kanban.`,
      ownerUserId: session.sub,
    });

    revalidatePath("/leads");
    revalidatePath("/leads/board");
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  });
}

// ============================================================================
// CONVERT TO CUSTOMER
// ============================================================================

const ConvertInput = z.object({
  accountId: z.string().uuid(),
});

export type ConvertLeadResult = {
  ok: boolean;
  error?: string;
};

/**
 * Flip a prospect account to customer status. Called from the "Mark as
 * customer" button on the account detail page when status='prospect'.
 *
 * Side effects, all inside one transaction:
 *  - account_status = 'customer'
 *  - converted_at = now()
 *  - sales_funnel_stage = 'closed_won' (frozen — we don't repurpose this for
 *    renewal/churn analytics; it stays closed_won as a record of the lead
 *    lifecycle)
 *  - 'note' activity 'Converted from prospect to customer' so the timeline
 *    shows the conversion event clearly
 *
 * Idempotent: if the account is already a customer, returns ok without
 * doing anything.
 */
export async function convertLeadAction(
  input: z.infer<typeof ConvertInput>,
): Promise<ConvertLeadResult> {
  const session = await requireSession();
  const parsed = ConvertInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { accountId } = parsed.data;

  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({
        id: accounts.id,
        territory: accounts.territory,
        accountStatus: accounts.accountStatus,
        companyName: accounts.companyName,
      })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!acct) return { ok: false, error: "Account not found" };

    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    if (acct.accountStatus === "customer") {
      return { ok: true };
    }
    if (acct.accountStatus !== "prospect") {
      return {
        ok: false,
        error: `Cannot convert ${acct.accountStatus} account`,
      };
    }

    const now = new Date();
    await tx
      .update(accounts)
      .set({
        accountStatus: "customer",
        salesFunnelStage: "closed_won",
        salesFunnelStageChangedAt: now,
        convertedAt: now,
        updatedAt: now,
      })
      .where(eq(accounts.id, accountId));

    await tx.insert(activities).values({
      accountId,
      type: "note",
      direction: "na",
      subject: "Converted to customer",
      body: `${acct.companyName} converted from prospect to customer.`,
      ownerUserId: session.sub,
    });

    // Note: we deliberately do NOT auto-close any open opportunities here.
    // Conversion just flips the account-level status; the rep should close
    // each opp explicitly when its specific service is signed. Auto-closing
    // would mask in-flight negotiations and corrupt opportunity-level
    // forecasting.

    revalidatePath("/leads");
    revalidatePath("/leads/board");
    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  });
}
