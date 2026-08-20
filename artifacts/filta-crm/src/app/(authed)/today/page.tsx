// Today view — the reps' morning starting point.
//
// Four buckets: Overdue / Today / This Week / Later. Each task is one row
// with mark-done, snooze (1/3/7d), and a deep-link to the account detail.
// Everything is scoped to the current user's own assigned tasks by default.
// Admins can switch to "All" to see the whole territory's backlog.

import Link from "next/link";
import { getTodayTasksForUser, type TodayRow } from "../tasks/actions";
import { requireSession } from "@/lib/session";
import { TaskRow } from "./TaskRow";
import { QuickAddTask } from "./QuickAddTask";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const scopeAll = params.scope === "all" && session.territory === "both";

  const buckets = await getTodayTasksForUser({ all: scopeAll });
  const total =
    buckets.overdue.length +
    buckets.today.length +
    buckets.thisWeek.length +
    buckets.later.length;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Today
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {total === 0
              ? "You're caught up."
              : `${total} open follow-up${total === 1 ? "" : "s"}${
                  scopeAll ? " across the territory" : ""
                }.`}
          </p>
        </div>
        {session.territory === "both" && (
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/today"
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                scopeAll
                  ? "text-slate-600 hover:bg-slate-100"
                  : "bg-filta-blue text-white"
              }`}
            >
              Mine
            </Link>
            <Link
              href="/today?scope=all"
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                scopeAll
                  ? "bg-filta-blue text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              All
            </Link>
          </div>
        )}
      </section>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <Bucket
            title="Overdue"
            subtitle={`${buckets.overdue.length} past due`}
            accent="rose"
            rows={buckets.overdue}
          />
          <Bucket
            title="Today"
            subtitle={`${buckets.today.length} due today`}
            accent="blue"
            rows={buckets.today}
          />
          <Bucket
            title="This week"
            subtitle={`${buckets.thisWeek.length} due in next 7 days`}
            accent="slate"
            rows={buckets.thisWeek}
          />
          {buckets.later.length > 0 && (
            <Bucket
              title="Later"
              subtitle={`${buckets.later.length} queued past this week`}
              accent="slate"
              rows={buckets.later}
              collapsible
            />
          )}
        </div>
      )}
    </div>
  );
}

function Bucket({
  title,
  subtitle,
  accent,
  rows,
  collapsible,
}: {
  title: string;
  subtitle: string;
  accent: "rose" | "blue" | "slate";
  rows: TodayRow[];
  collapsible?: boolean;
}) {
  if (rows.length === 0 && accent !== "blue") return null;

  const accentCls =
    accent === "rose"
      ? "border-l-4 border-rose-500"
      : accent === "blue"
        ? "border-l-4 border-filta-blue"
        : "border-l-4 border-slate-300";

  return (
    <details open={!collapsible} className="group rounded-lg bg-white shadow-sm">
      <summary
        className={`flex cursor-pointer list-none items-center justify-between rounded-t-lg px-4 py-3 ${accentCls}`}
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        {collapsible && (
          <span className="text-xs text-slate-500 group-open:hidden">
            Show
          </span>
        )}
      </summary>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          Nothing due. Nice.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} showBucketDate={accent !== "blue"} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-filta-light-blue text-filta-blue">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-slate-900">No follow-ups queued</h2>
      <p className="mt-1 text-sm text-slate-600">
        When you add a &quot;next step&quot; on an account or opportunity, it
        shows up here.
      </p>
      <div className="mt-5">
        <QuickAddTask compact />
      </div>
    </div>
  );
}
