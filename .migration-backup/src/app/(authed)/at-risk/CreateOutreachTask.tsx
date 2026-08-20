"use client";

// One-click "Create outreach task" button on the at-risk queue. Drops a
// task assigned to the current user, due tomorrow, with the most urgent
// risk reason copied into the notes so the rep walks into the call with
// context. Mirrors the brevity of the FS-cross-sell SendEmailButton —
// confirm, fire, render success state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction } from "../tasks/actions";

export default function CreateOutreachTask({
  accountId,
  companyName,
  topReason,
}: {
  accountId: string;
  companyName: string;
  /** The first (highest-severity) signal text — copied into task notes. */
  topReason: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    const ok = window.confirm(
      `Create an outreach task for ${companyName} due tomorrow?`,
    );
    if (!ok) return;

    startTransition(async () => {
      // Tomorrow, in YYYY-MM-DD. UTC date is fine — server normalizes.
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const due = tomorrow.toISOString().slice(0, 10);

      const res = await createTaskAction({
        accountId,
        title: `Reach out to ${companyName}`,
        notes: `Auto-flagged on /at-risk: ${topReason}`,
        dueDate: due,
        priority: "high",
        autoSource: "at_risk_queue_v1",
      });
      if (!res.ok) {
        setError(res.error ?? "Failed to create task");
        return;
      }
      setCreated(true);
      // Refresh so the queue reflects any state changes — and so the
      // /today badge in the nav picks up the new task.
      router.refresh();
    });
  }

  if (created) {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
        ✓ Task created
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-md border border-filta-blue bg-white px-3 py-1.5 text-xs font-semibold text-filta-blue shadow-sm hover:bg-filta-light-blue disabled:opacity-60"
      >
        {isPending ? "Creating…" : "Create outreach task"}
      </button>
      {error ? (
        <span className="max-w-[180px] text-right text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}
