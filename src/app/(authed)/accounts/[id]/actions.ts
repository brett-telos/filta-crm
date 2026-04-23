"use server";

// Server actions for the account detail page. For Week 2 we only need two:
// quick-log an activity, and update account status/notes. More (edit address,
// merge duplicates, reassign owner) will come in Week 3+.

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accounts, activities, withSession } from "@/db";
import { requireSession } from "@/lib/session";

const LogInput = z.object({
  accountId: z.string().uuid(),
  type: z.enum(["call", "email", "meeting", "visit", "note", "task"]),
  direction: z.enum(["inbound", "outbound", "na"]).optional(),
  disposition: z
    .enum([
      "connected",
      "left_voicemail",
      "no_answer",
      "wrong_number",
      "number_disconnected",
      "line_busy",
      "not_interested",
      "dnc",
      "callback_scheduled",
      "meeting_booked",
      "site_eval_booked",
      "demo_booked",
      "dm_unavailable",
      "language_barrier",
      "corporate_decision",
      "chain_decision",
      "not_qualified",
      "other",
    ])
    .optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
  durationMinutes: z
    .string()
    .optional()
    .transform((v) => (v && v.length ? Number(v) : undefined))
    .pipe(z.number().int().min(0).max(600).optional()),
});

export type LogState = {
  error?: string;
  ok?: boolean;
};

export async function logActivityAction(
  _prev: LogState,
  formData: FormData,
): Promise<LogState> {
  const session = await requireSession();

  const parsed = LogInput.safeParse({
    accountId: formData.get("accountId"),
    type: formData.get("type"),
    direction: formData.get("direction") || undefined,
    disposition: formData.get("disposition") || undefined,
    subject: formData.get("subject") || undefined,
    body: formData.get("body") || undefined,
    durationMinutes: formData.get("durationMinutes") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const { accountId, type, direction, disposition, subject, body, durationMinutes } =
    parsed.data;

  // Make sure the account exists (and isn't deleted). Also re-check territory
  // scoping so a rep can't log on an account outside their territory. RLS is
  // enforced via withSession — a cross-territory write is rejected by the DB
  // even if this check is ever removed.
  return withSession(session, async (tx) => {
    const [acct] = await tx
      .select({
        id: accounts.id,
        territory: accounts.territory,
        deletedAt: accounts.deletedAt,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);

    if (!acct || acct.deletedAt) {
      return { error: "Account not found." };
    }
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { error: "You don't have access to that account." };
    }

    await tx.insert(activities).values({
      accountId,
      type,
      direction: direction ?? "na",
      disposition,
      subject: subject?.trim() || undefined,
      body: body?.trim() || undefined,
      durationMinutes,
      ownerUserId: session.sub,
    });

    // Bump account updated_at so "recently active" sorts reflect the touch.
    await tx
      .update(accounts)
      .set({ updatedAt: sql`now()` })
      .where(eq(accounts.id, accountId));

    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  });
}

const NotesInput = z.object({
  accountId: z.string().uuid(),
  notes: z.string().max(8000),
  accountStatus: z.enum(["prospect", "customer", "churned", "do_not_contact"]),
});

export async function updateAccountAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = NotesInput.safeParse({
    accountId: formData.get("accountId"),
    notes: formData.get("notes") ?? "",
    accountStatus: formData.get("accountStatus"),
  });
  if (!parsed.success) return;

  await withSession(session, async (tx) => {
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.accountId))
      .limit(1);

    if (!acct || acct.deletedAt) return;
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return;
    }

    await tx
      .update(accounts)
      .set({
        notes: parsed.data.notes,
        accountStatus: parsed.data.accountStatus,
        updatedAt: sql`now()`,
      })
      .where(eq(accounts.id, parsed.data.accountId));

    revalidatePath(`/accounts/${parsed.data.accountId}`);
  });
}
