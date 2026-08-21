"use client";

// Leads kanban — same drag-drop pattern as PipelineBoard but for accounts.
//
// Mobile fallback: each card has a stage <select> for users who can't drag
// (touch screens) — same approach as the pipeline board.
//
// Optimistic UI: move locally first, then call the server action; on failure
// revert and show a toast.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveLeadStageAction } from "../actions";

export type LeadCard = {
  id: string;
  companyName: string;
  city: string | null;
  territory: "fun_coast" | "space_coast" | "unassigned";
  salesFunnelStage: Stage;
  salesFunnelStageChangedAt: string; // ISO
  fryerCount: number | null;
  ncaFlag: boolean;
  ncaName: string | null;
  lastActivityAt: string | null; // ISO
};

type Stage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

// Stages displayed on the active funnel board. closed_won/closed_lost are
// reachable via the dropdown but not shown as columns — once a lead's won
// they should be a customer (use the convert button on the account detail
// page); once they're lost they belong on /leads?view=lost. Mirrors the
// PipelineBoard list which DOES show all 7 stages because opportunities
// genuinely live their full lifecycle on that board.
const STAGES: { value: Stage; label: string; tint: string }[] = [
  { value: "new_lead", label: "New Lead", tint: "bg-slate-100" },
  { value: "contacted", label: "Contacted", tint: "bg-blue-50" },
  { value: "qualified", label: "Qualified", tint: "bg-indigo-50" },
  { value: "proposal", label: "Proposal", tint: "bg-violet-50" },
  { value: "negotiation", label: "Negotiation", tint: "bg-amber-50" },
];

const ALL_STAGE_OPTIONS: { value: Stage; label: string }[] = [
  ...STAGES,
  { value: "closed_won", label: "Closed Won" },
  { value: "closed_lost", label: "Closed Lost" },
];

export default function LeadsBoard({
  initialCards,
}: {
  initialCards: LeadCard[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Group only the stages we render as columns. Cards in closed_* stages
  // would normally not appear here (server filters them via view='active'),
  // but we tolerate them silently rather than throwing if they leak through.
  const byStage: Record<Stage, LeadCard[]> = {
    new_lead: [],
    contacted: [],
    qualified: [],
    proposal: [],
    negotiation: [],
    closed_won: [],
    closed_lost: [],
  };
  for (const c of cards) byStage[c.salesFunnelStage].push(c);

  function onDragStart(e: React.DragEvent, id: string) {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function onDragOver(e: React.DragEvent, stage: Stage) {
    e.preventDefault();
    if (overStage !== stage) setOverStage(stage);
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent, stage: Stage) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setOverStage(null);
    setDragId(null);
    if (!id) return;
    moveCard(id, stage);
  }

  function moveCard(id: string, stage: Stage) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.salesFunnelStage === stage) return;

    const previous = cards;
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              salesFunnelStage: stage,
              salesFunnelStageChangedAt: new Date().toISOString(),
            }
          : c,
      ),
    );

    startTransition(async () => {
      const res = await moveLeadStageAction({ accountId: id, stage });
      if (!res.ok) {
        setCards(previous);
        setError(res.error ?? "Move failed");
        setTimeout(() => setError(null), 3000);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <p className="px-1 text-xs text-slate-500 md:hidden">
        Swipe to browse stages. Tap a card&apos;s stage selector to move it.
      </p>

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 md:snap-none">
        {STAGES.map((s) => {
          const items = byStage[s.value];
          const isOver = overStage === s.value;
          return (
            <div
              key={s.value}
              onDragOver={(e) => onDragOver(e, s.value)}
              onDrop={(e) => onDrop(e, s.value)}
              className={`flex w-[85vw] max-w-xs shrink-0 snap-start flex-col rounded-lg border md:w-72 md:max-w-none md:snap-align-none ${
                isOver
                  ? "border-filta-blue ring-2 ring-filta-blue/40"
                  : "border-slate-200"
              } ${s.tint}`}
            >
              <div className="border-b border-slate-200/70 px-3 py-2">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-700">
                  <span>{s.label}</span>
                  <span className="rounded bg-white/60 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {items.length}
                  </span>
                </div>
              </div>

              <div className="flex min-h-[200px] flex-col gap-2 p-2">
                {items.length === 0 ? (
                  <div className="flex h-16 items-center justify-center text-xs text-slate-400">
                    drop here
                  </div>
                ) : (
                  items.map((c) => (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, c.id)}
                      className={`cursor-grab rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm active:cursor-grabbing ${
                        isPending && dragId === c.id ? "opacity-50" : ""
                      }`}
                    >
                      <Link
                        href={`/accounts/${c.id}`}
                        className="block font-medium text-slate-900 hover:underline"
                      >
                        {c.companyName}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        {c.city ? <span>{c.city}</span> : null}
                        {c.fryerCount ? (
                          <span>· {c.fryerCount} fryer{c.fryerCount === 1 ? "" : "s"}</span>
                        ) : null}
                        {c.ncaFlag ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                            NCA{c.ncaName ? ` · ${c.ncaName}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{ageInStage(c.salesFunnelStageChangedAt)}</span>
                        <span>{lastTouchHint(c.lastActivityAt)}</span>
                      </div>
                      <label className="mt-2 block md:hidden">
                        <span className="sr-only">Move to stage</span>
                        <select
                          value={c.salesFunnelStage}
                          onChange={(e) =>
                            moveCard(c.id, e.target.value as Stage)
                          }
                          className="block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                        >
                          {ALL_STAGE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              Move to {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </article>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ageInStage(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1d in stage";
  return `${days}d in stage`;
}

function lastTouchHint(iso: string | null): string {
  if (!iso) return "no activity";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "touched today";
  if (days === 1) return "1d since touch";
  if (days <= 30) return `${days}d since touch`;
  return "stale";
}
