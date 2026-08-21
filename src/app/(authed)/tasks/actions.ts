"use server";

// Server actions for the Tasks / follow-ups feature.
//
// The shape is small on purpose: create, complete, snooze, update, delete.
// Completing a task also writes a companion activity row so the timeline
// remains the single source of truth for "what happened with this account".
//
// Every action runs inside withSession so RLS applies. The Today view, the
// account-detail sidebar widget, and the pipeline-card badge all call into
// these actions.

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  activities,
  opportunities,
  tasks,
  withSession,
} from "@/db";
import { requireSession } from "@/lib/session";

// ------------------------------------------------------------
// CREATE
// ------------------------------------------------------------

const CreateInput = z.object({
  accountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional().nullable(),
  // Date-only, YYYY-MM-DD. We keep tasks day-granular — hours aren't useful
  // for "call back next Tuesday" and they add complexity.
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD"),
  priority: z.enum(["low", "normal", "high"]).optional(),
  // Optional assignee override. If unset, defaults to the current user —
  // 99% of the time a rep is creating a task for themselves.
  assigneeUserId: z.string().uuid().optional(),
  // Internal: when another flow auto-creates a task (e.g. FS cross-sell
  // send → 5-day follow-up), it passes this so we can audit later.
  autoSource: z.string().max(100).optional(),
});

export type CreateTaskResult = {
  ok: boolean;
  error?: string;
  taskId?: string;
};

export async function createTaskAction(
  input: z.infer<typeof CreateInput>,
): Promise<CreateTaskResult> {
  const session = await requireSession();
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const {
    accountId,
    opportunityId,
    title,
    notes,
    dueDate,
    priority,
    assigneeUserId,
    autoSource,
  } = parsed.data;

  return withSession(session, async (tx) => {
    // Verify the account exists, isn't soft-deleted, and is in the caller's
    // territory. RLS enforces the same at the DB layer, but the friendlier
    // error surfaces in the app before the insert ever fires.
    const [acct] = await tx
      .select({ territory: accounts.territory, deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);

    if (!acct || acct.deletedAt) return { ok: false, error: "Account not found" };
    if (
      session.territory !== "both" &&
      acct.territory !== session.territory &&
      acct.territory !== "unassigned"
    ) {
      return { ok: false, error: "Access denied" };
    }

    // If an opportunity was supplied, make sure it belongs to this same
    // account — we don't want tasks pointing at mismatched account/opp pairs.
    if (opportunityId) {
      const [opp] = await tx
        .select({ accountId: opportunities.accountId })
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);
      if (!opp || opp.accountId !== accountId) {
        return { ok: false, error: "Opportunity does not belong to account" };
      }
    }

    const [row] = await tx
      .insert(tasks)
      .values({
        accountId,
        opportunityId: opportunityId ?? null,
        assigneeUserId: assigneeUserId ?? session.sub,
        title: title.trim(),
        notes: notes?.trim() || null,
        dueDate,
        priority: priority ?? "normal",
        createdByUserId: session.sub,
        autoSource: autoSource ?? null,
      })
      .returning({ id: tasks.id });

    revalidatePath("/today");
    revalidatePath(`/accounts/${accountId}`);
    if (opportunityId) revalidatePath("/pipeline");
    return { ok: true, taskId: row.id };
  });
}

// ------------------------------------------------------------
// COMPLETE
// ------------------------------------------------------------

// Completing a task does two things: flip status→done + set completed_at,
// and write a task-type activity row so the timeline shows the follow-up
// actually happened.
const CompleteInput = z.object({
  taskId: z.string().uuid(),
});

export async function completeTaskAction(
  input: z.infer<typeof CompleteInput>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  return withSession(session, async (tx) => {
    const [task] = await tx
      .select({
        id: tasks.id,
        accountId: tasks.accountId,
        opportunityId: tasks.opportunityId,
        title: tasks.title,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, parsed.data.taskId))
      .limit(1);

    if (!task) return { ok: false, error: "Task not found" };
    if (task.status === "done") return { ok: true }; // idempotent

    await tx
      .update(tasks)
      .set({ status: "done", completedAt: sql`now()` })
      .where(eq(tasks.id, task.id));

    // Timeline entry. Subject mirrors the task title so it reads naturally
    // ("Task: Follow up on FS proposal"). If the user wants to add notes at
    // completion time they can still use the quick-log form.
    await tx.insert(activities).values({
      accountId: task.accountId,
      opportunityId: task.opportunityId ?? undefined,
      type: "task",
      direction: "na",
      subject: `Task: ${task.title}`,
      ownerUserId: session.sub,
    });

    revalidatePath("/today");
    revalidatePath(`/accounts/${task.accountId}`);
    if (task.opportunityId) revalidatePath("/pipeline");
    return { ok: true };
  });
}

// ------------------------------------------------------------
// SNOOZE
// ------------------------------------------------------------

// Push due_date out by N days, bump snooze_count, keep status = open (or
// flip snoozed→open if it was snoozed). We don't use a separate "snoozed"
// status in the common case — a snoozed-forward task with a future due_date
// just doesn't show in the Overdue/Today buckets until its date arrives.
// The `snoozed` enum value exists for a future "indefinitely parked" flow.
const SnoozeInput = z.object({
  taskId: z.string().uuid(),
  days: z.number().int().min(1).max(60),
});

export async function snoozeTaskAction(
  input: z.infer<typeof SnoozeInput>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const parsed = SnoozeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  return withSession(session, async (tx) => {
    const [task] = await tx
      .select({
        id: tasks.id,
        accountId: tasks.accountId,
        dueDate: tasks.dueDate,
        snoozeCount: tasks.snoozeCount,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, parsed.data.taskId))
      .limit(1);

    if (!task) return { ok: false, error: "Task not found" };
    if (task.status === "done") {
      return { ok: false, error: "Can't snooze a completed task" };
    }

    // Snooze forward from max(today, current_due_date) so snoozing an
    // already-future task actually pushes it further, and snoozing an
    // overdue task bumps from today (not from the original stale date).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const currentDue = new Date(`${task.dueDate}T00:00:00Z`);
    const base = currentDue > today ? currentDue : today;
    const nextDue = new Date(base);
    nextDue.setUTCDate(nextDue.getUTCDate() + parsed.data.days);
    const nextDueStr = nextDue.toISOString().slice(0, 10);

    await tx
      .update(tasks)
      .set({
        dueDate: nextDueStr,
        snoozeCount: task.snoozeCount + 1,
        status: "open",
      })
      .where(eq(tasks.id, task.id));

    revalidatePath("/today");
    revalidatePath(`/accounts/${task.accountId}`);
    return { ok: true };
  });
}

// ------------------------------------------------------------
// UPDATE (title / notes / due date / priority / assignee / opp link)
// ------------------------------------------------------------

const UpdateInput = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  assigneeUserId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
});

export async function updateTaskAction(
  input: z.infer<typeof UpdateInput>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const patch = parsed.data;

  return withSession(session, async (tx) => {
    const [existing] = await tx
      .select({ id: tasks.id, accountId: tasks.accountId })
      .from(tasks)
      .where(eq(tasks.id, patch.taskId))
      .limit(1);

    if (!existing) return { ok: false, error: "Task not found" };

    const update: Record<string, unknown> = {};
    if (patch.title !== undefined) update.title = patch.title.trim();
    if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
    if (patch.dueDate !== undefined) update.dueDate = patch.dueDate;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.assigneeUserId !== undefined) update.assigneeUserId = patch.assigneeUserId;
    if (patch.opportunityId !== undefined) update.opportunityId = patch.opportunityId;

    if (Object.keys(update).length === 0) return { ok: true };

    await tx.update(tasks).set(update).where(eq(tasks.id, patch.taskId));

    revalidatePath("/today");
    revalidatePath(`/accounts/${existing.accountId}`);
    return { ok: true };
  });
}

// ------------------------------------------------------------
// DELETE
// ------------------------------------------------------------

// Hard delete — tasks aren't audit-critical the way accounts/opps are.
// If a user adds a task by mistake, they want it gone, not soft-deleted.
const DeleteInput = z.object({ taskId: z.string().uuid() });

export async function deleteTaskAction(
  input: z.infer<typeof DeleteInput>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const parsed = DeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  return withSession(session, async (tx) => {
    const [task] = await tx
      .select({ accountId: tasks.accountId })
      .from(tasks)
      .where(eq(tasks.id, parsed.data.taskId))
      .limit(1);

    if (!task) return { ok: true }; // already gone — idempotent

    await tx.delete(tasks).where(eq(tasks.id, parsed.data.taskId));

    revalidatePath("/today");
    revalidatePath(`/accounts/${task.accountId}`);
    return { ok: true };
  });
}

// ------------------------------------------------------------
// Helper: internal-only task creator used by other server actions
// ------------------------------------------------------------

// Used by the FS cross-sell send flow (Week 3.1) — skips user input parsing,
// takes trusted args, and runs inside an already-open transaction. Keep this
// internal: it's exported from the same 'use server' file but is only meant
// to be called from other server-side callers, not from the client.
export async function createAutoFollowUpTask(
  tx: Parameters<Parameters<typeof withSession>[1]>[0],
  args: {
    accountId: string;
    opportunityId?: string | null;
    assigneeUserId: string;
    title: string;
    notes?: string | null;
    daysOut: number;
    autoSource: string;
  },
): Promise<string> {
  const due = new Date();
  due.setUTCHours(0, 0, 0, 0);
  due.setUTCDate(due.getUTCDate() + args.daysOut);
  const dueStr = due.toISOString().slice(0, 10);

  const [row] = await tx
    .insert(tasks)
    .values({
      accountId: args.accountId,
      opportunityId: args.opportunityId ?? null,
      assigneeUserId: args.assigneeUserId,
      title: args.title,
      notes: args.notes ?? null,
      dueDate: dueStr,
      priority: "normal",
      createdByUserId: args.assigneeUserId,
      autoSource: args.autoSource,
    })
    .returning({ id: tasks.id });

  return row.id;
}

// ------------------------------------------------------------
// Queries — colocated with actions so the UI has one import site
// ------------------------------------------------------------

export type TodayRow = {
  id: string;
  accountId: string;
  accountName: string;
  opportunityId: string | null;
  title: string;
  notes: string | null;
  dueDate: string; // YYYY-MM-DD
  priority: "low" | "normal" | "high";
  snoozeCount: number;
};

export type TodayBuckets = {
  overdue: TodayRow[];
  today: TodayRow[];
  thisWeek: TodayRow[];
  later: TodayRow[];
};

// Today view data. Assignee-scoped to the current user by default, but a
// manager with territory='both' can pass `all: true` to see the whole
// territory's follow-ups.
export async function getTodayTasksForUser(
  opts: { all?: boolean } = {},
): Promise<TodayBuckets> {
  const session = await requireSession();

  return withSession(session, async (tx) => {
    const rows = await tx
      .select({
        id: tasks.id,
        accountId: tasks.accountId,
        accountName: accounts.companyName,
        opportunityId: tasks.opportunityId,
        title: tasks.title,
        notes: tasks.notes,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
        snoozeCount: tasks.snoozeCount,
      })
      .from(tasks)
      .innerJoin(accounts, eq(accounts.id, tasks.accountId))
      .where(
        opts.all
          ? eq(tasks.status, "open")
          : and(eq(tasks.status, "open"), eq(tasks.assigneeUserId, session.sub)),
      )
      .orderBy(tasks.dueDate, tasks.priority);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const weekEnd = new Date(today);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const buckets: TodayBuckets = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
    };

    for (const r of rows) {
      const row = r as TodayRow;
      if (row.dueDate < todayStr) buckets.overdue.push(row);
      else if (row.dueDate === todayStr) buckets.today.push(row);
      else if (row.dueDate <= weekEndStr) buckets.thisWeek.push(row);
      else buckets.later.push(row);
    }

    // High-priority bubbles to the top of each bucket. DB ordered by
    // dueDate+priority ascending, so re-sort priority first within bucket.
    const priorityRank = { high: 0, normal: 1, low: 2 } as const;
    const sortInPlace = (arr: TodayRow[]) =>
      arr.sort((a, b) =>
        a.dueDate === b.dueDate
          ? priorityRank[a.priority] - priorityRank[b.priority]
          : a.dueDate.localeCompare(b.dueDate),
      );
    sortInPlace(buckets.overdue);
    sortInPlace(buckets.today);
    sortInPlace(buckets.thisWeek);
    sortInPlace(buckets.later);

    return buckets;
  });
}

// Account-detail sidebar widget — only this account's open tasks.
export async function getOpenTasksForAccount(
  accountId: string,
): Promise<TodayRow[]> {
  const session = await requireSession();

  return withSession(session, async (tx) => {
    const rows = await tx
      .select({
        id: tasks.id,
        accountId: tasks.accountId,
        accountName: accounts.companyName,
        opportunityId: tasks.opportunityId,
        title: tasks.title,
        notes: tasks.notes,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
        snoozeCount: tasks.snoozeCount,
      })
      .from(tasks)
      .innerJoin(accounts, eq(accounts.id, tasks.accountId))
      .where(and(eq(tasks.accountId, accountId), eq(tasks.status, "open")))
      .orderBy(tasks.dueDate);

    return rows as TodayRow[];
  });
}

// Nav badge + dashboard widget — compact counts only.
export async function getTaskCountsForUser(): Promise<{
  overdue: number;
  today: number;
  thisWeek: number;
}> {
  const session = await requireSession();

  return withSession(session, async (tx) => {
    const result = await tx.execute<{
      overdue: string;
      today: string;
      this_week: string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE due_date < current_date)                                AS overdue,
        count(*) FILTER (WHERE due_date = current_date)                                AS today,
        count(*) FILTER (WHERE due_date > current_date AND due_date <= current_date + 7) AS this_week
      FROM tasks
      WHERE status = 'open' AND assignee_user_id = ${session.sub}
    `);
    const row = (result as unknown as { rows: Array<{ overdue: string; today: string; this_week: string }> }).rows[0];
    return {
      overdue: Number(row?.overdue ?? 0),
      today: Number(row?.today ?? 0),
      thisWeek: Number(row?.this_week ?? 0),
    };
  });
}
