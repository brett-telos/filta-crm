"use client";

// Apply / Abort actions for a pending billing import. Both go through
// confirmation prompts since they're irreversible (apply writes to many
// account rows; abort marks the row terminal).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  abortBillingImportAction,
  applyBillingImportAction,
} from "../actions";

export default function ApplyAbortButtons({
  billingImportId,
}: {
  billingImportId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApply() {
    setError(null);
    setSuccess(null);
    const ok = window.confirm(
      `Apply this import? Updates will be written to accounts.service_profile.\nThis cannot be undone via the UI; you'd need to revert via SQL.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await applyBillingImportAction({ id: billingImportId });
      if (!res.ok) {
        setError(res.error ?? "Apply failed");
        return;
      }
      setSuccess(`Applied — ${res.rowsUpdated ?? 0} accounts updated.`);
      router.refresh();
    });
  }

  function handleAbort() {
    setError(null);
    setSuccess(null);
    const note = window.prompt(
      `Optional: why are you aborting this import? (leave blank to skip)`,
    );
    if (note === null) return; // cancel
    startTransition(async () => {
      const res = await abortBillingImportAction({
        id: billingImportId,
        notes: note || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Abort failed");
        return;
      }
      setSuccess("Aborted.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <button
        type="button"
        onClick={handleApply}
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Working…" : "Apply changes"}
      </button>
      <button
        type="button"
        onClick={handleAbort}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        Abort
      </button>
      {error ? (
        <span className="text-sm text-red-700">{error}</span>
      ) : null}
      {success ? (
        <span className="text-sm text-emerald-700">{success}</span>
      ) : null}
    </div>
  );
}
