"use client";

// HTML5 drag-drop kanban — no external dnd lib to keep bundle size small.
// Optimistic UI: we move the card in local state immediately, then call the
// server action. On failure we revert and show a toast.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveOpportunityStageAction } from "./actions";

export type PipelineCard = {
  id: string;
  name: string;
  stage: Stage;
  serviceType: string;
  accountId: string;
  accountName: string;
  ownerFirstName: string | null;
  ownerEmail: string | null;
  estimatedValueAnnual: string | null;
  stageChangedAt: string; // ISO
};

type Stage =
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

const STAGES: { value: Stage; label: string; tint: string }[] = [
  { value: "new_lead", label: "New Lead", tint: "bg-slate-100" },
  { value: "contacted", label: "Contacted", tint: "bg-blue-50" },
  { value: "qualified", label: "Qualified", tint: "bg-indigo-50" },
  { value: "proposal", label: "Proposal", tint: "bg-violet-50" },
  { value: "negotiation", label: "Negotiation", tint: "bg-amber-50" },
  { value: "closed_won", label: "Closed Won", tint: "bg-emerald-50" },
  { value: "closed_lost", label: "Closed Lost", tint: "bg-rose-50" },
];

export default function PipelineBoard({
  initialCards,
}: {
  initialCards: PipelineCard[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const byStage: Record<Stage, PipelineCard[]> = {
    new_lead: [],
    contacted: [],
    qualified: [],
    proposal: [],
    negotiation: [],
    closed_won: [],
    closed_lost: [],
  };
  for (const c of cards) byStage[c.stage].push(c);

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

  // Shared between the HTML5 drop and the mobile <select> change handler.
  function moveCard(id: string, stage: Stage) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === stage) return;

    const previous = cards;
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, stage, stageChangedAt: new Date().toISOString() }
          : c,
      ),
    );

    startTransition(async () => {
      const res = await moveOpportunityStageAction({
        opportunityId: id,
        stage,
      });
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

      {/* Hint + snap-scroll helper on mobile, where drag-and-drop is awkward */}
      <p className="px-1 text-xs text-slate-500 md:hidden">
        Swipe to browse stages. Tap a card's stage selector to move it.
      </p>

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 md:snap-none">
        {STAGES.map((s) => {
          const items = byStage[s.value];
          const totalValue = items.reduce(
            (sum, c) => sum + Number(c.estimatedValueAnnual ?? 0),
            0,
          );
          const isOver = overStage === s.value;
          return (
            <div
              key={s.value}
              onDragOver={(e) => onDragOver(e, s.value)}
              onDrop={(e) => onDrop(e, s.value)}
              className={`flex w-[85vw] max-w-xs shrink-0 snap-start flex-col rounded-lg border md:w-72 md:max-w-none md:snap-align-none ${
                isOver ? "border-filta-blue ring-2 ring-filta-blue/40" : "border-slate-200"
              } ${s.tint}`}
            >
              <div className="border-b border-slate-200/70 px-3 py-2">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-700">
                  <span>{s.label}</span>
                  <span className="rounded bg-white/60 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {items.length}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {formatCurrency(totalValue)}
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
                        href={`/accounts/${c.accountId}`}
                        className="block font-medium text-slate-900 hover:underline"
                      >
                        {c.accountName}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {c.name}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium uppercase">
                          {c.serviceType}
                        </span>
                        <span>
                          {formatCurrency(Number(c.estimatedValueAnnual ?? 0))}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        {c.ownerFirstName ?? c.ownerEmail ?? "unassigned"} ·{" "}
                        {ageInStage(c.stageChangedAt)}
                      </div>
                      {/* Mobile-only stage picker: tap target for users who can't drag */}
                      <label className="mt-2 block md:hidden">
                        <span className="sr-only">Move to stage</span>
                        <select
                          value={c.stage}
                          onChange={(e) =>
                            moveCard(c.id, e.target.value as Stage)
                          }
                          className="block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                        >
                          {STAGES.map((opt) => (
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

function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: n >= 100000 ? "compact" : "standard",
  }).format(n);
}

function ageInStage(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1d in stage";
  return `${days}d in stage`;
}
