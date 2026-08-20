"use client";

// A single task row on the Today view. Three actions, always one tap away:
//  - Done  (filta-blue CTA, most common action)
//  - Snooze 1d / 3d / 7d  (inline menu)
//  - Click title → account detail
//
// Optimistic: clicking Done fades the row out before the server round-trip
// completes, and triggers a router.refresh() on success to re-bucket.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  completeTaskAction,
  snoozeTaskAction,
  type TodayRow,
} from "../tasks/actions";
import { formatDateShort } from "@/lib/format";

export function TaskRow({
  task,
  showBucketDate,
  compact,
  hideAccountName,
}: {
  task: TodayRow;
  showBucketDate?: boolean;
  compact?: boolean;
  // Hide the account-name link when the row is already rendered inside
  // that account's detail page (avoids redundancy).
  hideAccountName?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fading, setFading] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  function onDone() {
    setFading(true);
    startTransition(async () => {
      const r = await completeTaskAction({ taskId: task.id });
      if (!r.ok) {
        setFading(false);
        alert(r.error ?? "Couldn't mark task done");
        return;
      }
      router.refresh();
    });
  }

  function onSnooze(days: number) {
    setSnoozeOpen(false);
    setFading(true);
    startTransition(async () => {
      const r = await snoozeTaskAction({ taskId: task.id, days });
      if (!r.ok) {
        setFading(false);
        alert(r.error ?? "Couldn't snooze task");
        return;
      }
      router.refresh();
    });
  }

  const priorityPill =
    task.priority === "high"
      ? "bg-rose-100 text-rose-800"
      : task.priority === "low"
        ? "bg-slate-100 text-slate-600"
        : null;

  return (
    <div
      className={`flex flex-col gap-3 px-4 py-3 transition sm:flex-row sm:items-center sm:justify-between ${
        fading ? "pointer-events-none opacity-40" : ""
      } ${compact ? "py-2" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {!hideAccountName && (
            <Link
              href={`/accounts/${task.accountId}`}
              className="truncate text-sm font-medium text-slate-900 hover:text-filta-blue"
            >
              {task.accountName}
            </Link>
          )}
          {priorityPill && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityPill}`}
            >
              {task.priority}
            </span>
          )}
          {task.snoozeCount >= 3 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
              snoozed {task.snoozeCount}×
            </span>
          )}
          {showBucketDate && (
            <span className="text-xs text-slate-500">
              {formatDateShort(task.dueDate)}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-slate-700">{task.title}</div>
        {task.notes && (
          <div className="mt-1 line-clamp-2 text-xs text-slate-500">
            {task.notes}
          </div>
        )}
      </div>

      <div className="relative flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onDone}
          className="inline-flex min-h-[36px] items-center justify-center rounded-md bg-filta-blue px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-filta-blue-dark focus:outline-none focus:ring-2 focus:ring-filta-blue focus:ring-offset-2 disabled:opacity-60"
        >
          Done
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setSnoozeOpen((v) => !v)}
          className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-filta-blue focus:ring-offset-2 disabled:opacity-60"
          aria-expanded={snoozeOpen}
        >
          Snooze
        </button>
        {snoozeOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-10 mt-1 w-32 rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {[
              { d: 1, label: "Tomorrow" },
              { d: 3, label: "3 days" },
              { d: 7, label: "1 week" },
            ].map((opt) => (
              <button
                key={opt.d}
                type="button"
                onClick={() => onSnooze(opt.d)}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
