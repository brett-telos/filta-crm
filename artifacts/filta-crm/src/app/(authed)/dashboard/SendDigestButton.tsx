"use client";

// Admin-only "Send digest now" button for the dashboard. POSTs to
// /api/digests/run?type=daily|weekly. Uses the session cookie for auth
// (no DIGEST_SECRET needed in-app). Shows a small success/error pill
// next to the dashboard header.

import { useState, useTransition } from "react";

export default function SendDigestButton() {
  const [type, setType] = useState<"daily" | "weekly">("daily");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSend() {
    setError(null);
    setResult(null);
    const ok = window.confirm(
      `Send the ${type} digest now to all admin users?`,
    );
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/digests/run?type=${type}`, {
          method: "POST",
          credentials: "include",
        });
        const body = (await res.json()) as {
          ok?: boolean;
          sent?: number;
          failed?: number;
          error?: string;
        };
        if (!res.ok || !body.ok) {
          setError(body.error ?? `Failed (${res.status})`);
          return;
        }
        setResult(
          `Sent to ${body.sent} admin${body.sent === 1 ? "" : "s"}${body.failed ? ` (${body.failed} failed)` : ""}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as "daily" | "weekly")}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
      <button
        type="button"
        onClick={handleSend}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Send digest now"}
      </button>
      {result ? (
        <span className="text-xs text-emerald-700">{result}</span>
      ) : null}
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
