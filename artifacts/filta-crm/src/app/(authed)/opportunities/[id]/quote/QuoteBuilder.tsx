"use client";

// Interactive quote builder. State lives entirely in this component while
// the rep edits — only on Save Draft / Save & Send do we go back to the
// server. That keeps the per-keystroke experience snappy.
//
// Each line item is a row of: service type · description · qty · unit
// price · frequency. Totals are computed live in the footer so the rep
// sees the annual run-rate change as they tweak.
//
// Save Draft → saveQuoteAction with the current lines.
// Save & Send → saveQuoteAction THEN sendQuoteAction. We do them in two
// steps so a save error doesn't trigger a send and a send error doesn't
// roll back the save (the draft is preserved on send failure for retry).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveQuoteAction, sendQuoteAction } from "../../../quotes/actions";

type ServiceType = "ff" | "fs" | "fb" | "fg" | "fc" | "fd";
type Frequency =
  | "per_visit"
  | "monthly"
  | "quarterly"
  | "annual"
  | "one_time";

export type Line = {
  id: string | null;
  serviceType: ServiceType | null;
  description: string;
  quantity: number;
  unitPrice: number;
  frequency: Frequency;
  displayOrder: number;
};

export type QuoteBuilderProps = {
  opportunityId: string;
  /** Existing draft id when editing; undefined when creating new. */
  quoteVersionId?: string;
  customer: {
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    addressLine: string | null;
  };
  initialLines: Line[];
  initialNotes: string;
  /** YYYY-MM-DD or empty string. */
  initialValidUntil: string;
  pricing: {
    ffPerFryerPerMonth: number;
    fsPerQuarter: number;
  };
};

const SERVICE_OPTIONS: Array<{ value: ServiceType; label: string }> = [
  { value: "ff", label: "FiltaFry" },
  { value: "fs", label: "FiltaClean" },
  { value: "fb", label: "FiltaBio" },
  { value: "fg", label: "FiltaGold" },
  { value: "fc", label: "FiltaCool" },
  { value: "fd", label: "FiltaDrain" },
];

const FREQ_OPTIONS: Array<{ value: Frequency; label: string }> = [
  { value: "per_visit", label: "Per visit" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One-time" },
];

const FREQ_TO_MONTHLY: Record<Frequency, number> = {
  per_visit: 4,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  one_time: 0,
};

export default function QuoteBuilder(props: QuoteBuilderProps) {
  const [lines, setLines] = useState<Line[]>(
    props.initialLines.length > 0
      ? props.initialLines
      : [emptyLine(props.pricing, 0)],
  );
  const [notes, setNotes] = useState(props.initialNotes);
  const [validUntil, setValidUntil] = useState(props.initialValidUntil);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [devStub, setDevStub] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const totals = useMemo(() => computeTotals(lines), [lines]);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function addLine(preset?: "ff_default" | "fs_default" | "blank") {
    const order = lines.length;
    let newLine: Line;
    if (preset === "ff_default") {
      newLine = {
        id: null,
        serviceType: "ff",
        description: "FiltaFry oil filtration",
        quantity: 1,
        unitPrice: props.pricing.ffPerFryerPerMonth,
        frequency: "monthly",
        displayOrder: order,
      };
    } else if (preset === "fs_default") {
      newLine = {
        id: null,
        serviceType: "fs",
        description: "FiltaClean — exhaust hood deep clean",
        quantity: 1,
        unitPrice: props.pricing.fsPerQuarter,
        frequency: "quarterly",
        displayOrder: order,
      };
    } else {
      newLine = emptyLine(props.pricing, order);
    }
    setLines((prev) => [...prev, newLine]);
  }

  async function persistDraft(): Promise<{
    ok: boolean;
    quoteVersionId?: string;
    error?: string;
  }> {
    if (lines.length === 0) {
      return { ok: false, error: "Add at least one line" };
    }
    const res = await saveQuoteAction({
      opportunityId: props.opportunityId,
      quoteVersionId: props.quoteVersionId,
      notes: notes || null,
      validUntilIso: validUntil || null,
      lines: lines.map((l, i) => ({
        id: l.id,
        serviceType: l.serviceType,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        frequency: l.frequency,
        displayOrder: i,
      })),
    });
    return res;
  }

  function handleSaveDraft() {
    setError(null);
    setSavedAt(null);
    startTransition(async () => {
      const res = await persistDraft();
      if (!res.ok) {
        setError(res.error ?? "Save failed");
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    });
  }

  function handleSaveAndSend() {
    setError(null);
    if (!props.customer.contactEmail) {
      setError("No contact email on file — add one before sending.");
      return;
    }
    const ok = window.confirm(
      `Send the quote to ${props.customer.contactName ?? props.customer.companyName} (${props.customer.contactEmail})?`,
    );
    if (!ok) return;

    startTransition(async () => {
      const save = await persistDraft();
      if (!save.ok || !save.quoteVersionId) {
        setError(save.error ?? "Save failed");
        return;
      }
      const send = await sendQuoteAction({
        quoteVersionId: save.quoteVersionId,
      });
      if (!send.ok) {
        setError(send.error ?? "Send failed (draft saved)");
        return;
      }
      setSentAt(new Date());
      setDevStub(!!send.devStub);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* Toolbar — quick-add presets */}
      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
        <button
          type="button"
          onClick={() => addLine("fs_default")}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          + FiltaClean line
        </button>
        <button
          type="button"
          onClick={() => addLine("ff_default")}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          + FiltaFry line
        </button>
        <button
          type="button"
          onClick={() => addLine("blank")}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          + Custom line
        </button>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">
            No line items yet. Add one above.
          </p>
        ) : (
          lines.map((line, idx) => (
            <div
              key={line.id ?? `new-${idx}`}
              className="grid grid-cols-12 items-start gap-2 rounded-md border border-slate-200 p-2"
            >
              <div className="col-span-12 sm:col-span-2">
                <label className="text-[10px] uppercase tracking-wide text-slate-500">
                  Service
                </label>
                <select
                  value={line.serviceType ?? ""}
                  onChange={(e) =>
                    updateLine(idx, {
                      serviceType: (e.target.value || null) as
                        | ServiceType
                        | null,
                    })
                  }
                  className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="">Other</option>
                  {SERVICE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-12 sm:col-span-5">
                <label className="text-[10px] uppercase tracking-wide text-slate-500">
                  Description
                </label>
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) =>
                    updateLine(idx, { description: e.target.value })
                  }
                  placeholder="What's being delivered?"
                  className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <label className="text-[10px] uppercase tracking-wide text-slate-500">
                  Qty
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={line.quantity}
                  onChange={(e) =>
                    updateLine(idx, {
                      quantity: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="text-[10px] uppercase tracking-wide text-slate-500">
                  Unit price
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) =>
                    updateLine(idx, {
                      unitPrice: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className="text-[10px] uppercase tracking-wide text-slate-500">
                  Frequency
                </label>
                <select
                  value={line.frequency}
                  onChange={(e) =>
                    updateLine(idx, {
                      frequency: e.target.value as Frequency,
                    })
                  }
                  className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                >
                  {FREQ_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-1 flex items-end justify-end">
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="text-slate-400 hover:text-rose-600"
                  title="Remove line"
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Notes + valid until */}
      <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">
            Notes (optional)
          </span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything to call out on the quote — first month free, scheduling notes, etc."
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">
            Valid until
          </span>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Defaults to 30 days. Leave blank for no expiry.
          </span>
        </label>
      </div>

      {/* Totals */}
      <div className="rounded-md bg-slate-50 p-3">
        <div className="grid gap-1 text-sm tabular-nums">
          {totals.subtotalMonthly > 0 ? (
            <Row label="Monthly recurring" value={totals.subtotalMonthly} />
          ) : null}
          {totals.subtotalQuarterly > 0 ? (
            <Row
              label="Quarterly recurring"
              value={totals.subtotalQuarterly}
            />
          ) : null}
          {totals.subtotalOneTime > 0 ? (
            <Row label="One-time charges" value={totals.subtotalOneTime} />
          ) : null}
          <div className="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-900">
              Estimated annual value
            </span>
            <span className="text-xl font-semibold text-filta-blue">
              {formatCurrency(totals.estimatedAnnual)}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="text-xs text-slate-500">
          {sentAt ? (
            <span className="text-emerald-700">
              ✓ Sent to {props.customer.contactEmail}
              {devStub ? " (dev stub)" : ""}
            </span>
          ) : savedAt ? (
            <span className="text-slate-700">Draft saved</span>
          ) : null}
          {error ? (
            <span className="text-red-700">{error}</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isPending || !!sentAt}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={handleSaveAndSend}
            disabled={isPending || !!sentAt}
            className="rounded-md bg-filta-blue px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-filta-blue-dark disabled:opacity-60"
          >
            {isPending ? "Working…" : sentAt ? "Sent" : "Save & send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function emptyLine(
  pricing: QuoteBuilderProps["pricing"],
  order: number,
): Line {
  return {
    id: null,
    serviceType: null,
    description: "",
    quantity: 1,
    unitPrice: 0,
    frequency: "monthly",
    displayOrder: order,
  };
}

function computeTotals(lines: Line[]) {
  let monthly = 0;
  let quarterly = 0;
  let oneTime = 0;
  let annual = 0;
  for (const l of lines) {
    const total = l.quantity * l.unitPrice;
    if (l.frequency === "monthly") monthly += total;
    else if (l.frequency === "quarterly") quarterly += total;
    else if (l.frequency === "one_time") oneTime += total;
    if (l.frequency !== "one_time") {
      annual += total * 12 * FREQ_TO_MONTHLY[l.frequency];
    }
  }
  return {
    subtotalMonthly: round2(monthly),
    subtotalQuarterly: round2(quarterly),
    subtotalOneTime: round2(oneTime),
    estimatedAnnual: round2(annual),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-900">{formatCurrency(value)}</span>
    </div>
  );
}
