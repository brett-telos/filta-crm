"use client";

// Sales funnel stage widget — shown on the account detail page when the
// account is a prospect. Two responsibilities:
//
//   1. Show the current sales_funnel_stage with a stage-change picker so the
//      rep can advance the lead without leaving the detail page (the same
//      action is also available via /leads/board drag-drop, but reps spend
//      most of their time on detail pages and want a path that doesn't
//      require navigating away).
//
//   2. "Mark as customer" button that flips account_status to 'customer'.
//      window.confirm() before flipping — irreversible-ish (you can manually
//      flip back via the Status & Notes form, but the conversion timestamp
//      and the activity entry are permanent).
//
// On any successful action we router.refresh() so the page re-renders with
// fresh server data — including the new "Converted to customer" timeline
// entry the action wrote.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertLeadAction,
  moveLeadStageAction,
} from "../../leads/actions";

type Stage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: "new_lead", label: "New Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "closed_lost", label: "Closed Lost" },
];

const STAGE_PILL_PALETTE: Record<Stage, string> = {
  new_lead: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-50 text-blue-700",
  qualified: "bg-indigo-50 text-indigo-700",
  proposal: "bg-violet-50 text-violet-700",
  negotiation: "bg-amber-50 text-amber-800",
  closed_won: "bg-emerald-50 text-emerald-700",
  closed_lost: "bg-rose-50 text-rose-700",
};

const STAGE_LABEL: Record<Stage, string> = {
  new_lead: "New Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

export default function SalesFunnelWidget({
  accountId,
  companyName,
  currentStage,
  stageChangedAt,
}: {
  accountId: string;
  companyName: string;
  currentStage: Stage;
  stageChangedAt: string; // ISO
}) {
  const [stage, setStage] = useState<Stage>(currentStage);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleStageChange(next: Stage) {
    if (next === stage) return;
    const previous = stage;
    setStage(next);
    setError(null);
    startTransition(async () => {
      const res = await moveLeadStageAction({ accountId, stage: next });
      if (!res.ok) {
        setStage(previous);
        setError(res.error ?? "Stage update failed");
        return;
      }
      router.refresh();
    });
  }

  function handleConvert() {
    const ok = window.confirm(
      `Mark ${companyName} as a customer? This stamps a conversion date and writes a note to the timeline. The account will move out of the leads list.`,
    );
    if (!ok) return;

    setError(null);
    startTransition(async () => {
      const res = await convertLeadAction({ accountId });
      if (!res.ok) {
        setError(res.error ?? "Conversion failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STAGE_PILL_PALETTE[stage]}`}
        >
          {STAGE_LABEL[stage]}
        </span>
        <span
          className="text-xs text-slate-500"
          title={new Date(stageChangedAt).toLocaleString()}
        >
          {ageInStage(stageChangedAt)}
        </span>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-600">
          Move to stage
        </span>
        <select
          value={stage}
          onChange={(e) => handleStageChange(e.target.value as Stage)}
          disabled={isPending}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm disabled:opacity-60"
        >
          {STAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={handleConvert}
        disabled={isPending}
        className="inline-flex w-full min-h-[40px] items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Working…" : "Mark as customer"}
      </button>

      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : (
        <p className="text-xs text-slate-500">
          Conversion stamps a timestamp + writes a timeline note. Reversible
          via the Status & Notes form below if needed.
        </p>
      )}
    </div>
  );
}

function ageInStage(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day in stage";
  return `${days} days in stage`;
}
