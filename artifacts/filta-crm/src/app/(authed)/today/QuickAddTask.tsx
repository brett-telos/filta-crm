"use client";

// Inline "+ Add task" form. Two modes:
//  - compact (default on Today empty state): just a "Pick an account" CTA
//    that routes to the accounts list.
//  - account-bound (on account detail sidebar): title + due date + notes,
//    all inline.
//
// The reason we split is that a truly-global "quick add from anywhere" form
// would need an account picker, which is clunky on mobile. Simpler to add
// tasks in context of an account.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTaskAction } from "../tasks/actions";

type Props =
  | { compact: true; accountId?: undefined; opportunityId?: undefined }
  | {
      compact?: false;
      accountId: string;
      opportunityId?: string | null;
    };

export function QuickAddTask(props: Props) {
  if (props.compact) {
    return (
      <Link
        href="/accounts"
        className="inline-flex items-center rounded-md bg-filta-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-filta-blue-dark"
      >
        Add a follow-up from an account
      </Link>
    );
  }
  return <InlineAddForm {...props} />;
}

function InlineAddForm({
  accountId,
  opportunityId,
}: {
  accountId: string;
  opportunityId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(() => nextBusinessDay());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setNotes("");
    setDueDate(nextBusinessDay());
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      const r = await createTaskAction({
        accountId,
        opportunityId: opportunityId ?? null,
        title,
        notes: notes || undefined,
        dueDate,
      });
      if (!r.ok) {
        setError(r.error ?? "Couldn't add task");
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-filta-blue hover:text-filta-blue"
      >
        + Add follow-up
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-md border border-slate-200 bg-white p-3"
    >
      <input
        autoFocus
        required
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Call back about FS quote"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-filta-blue focus:outline-none focus:ring-1 focus:ring-filta-blue"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600">Due</label>
        <input
          type="date"
          required
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-filta-blue focus:outline-none focus:ring-1 focus:ring-filta-blue"
        />
        <QuickDateButtons onPick={setDueDate} />
      </div>
      <textarea
        maxLength={2000}
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-filta-blue focus:outline-none focus:ring-1 focus:ring-filta-blue"
      />
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="rounded-md bg-filta-blue px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-filta-blue-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function QuickDateButtons({ onPick }: { onPick: (d: string) => void }) {
  const opts: [string, number][] = [
    ["Today", 0],
    ["Tmrw", 1],
    ["+3d", 3],
    ["+1w", 7],
  ];
  return (
    <div className="hidden items-center gap-1 sm:flex">
      {opts.map(([label, days]) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(dateFromTodayOffset(days))}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:border-filta-blue hover:text-filta-blue"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function dateFromTodayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Default a new task to tomorrow (or Monday if tomorrow is a weekend).
function nextBusinessDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2); // Sat -> Mon
  else if (dow === 0) d.setDate(d.getDate() + 1); // Sun -> Mon
  return d.toISOString().slice(0, 10);
}
