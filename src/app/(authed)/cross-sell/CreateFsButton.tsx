"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFsOpportunityAction } from "./actions";

export default function CreateFsButton({ accountId }: { accountId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await createFsOpportunityAction({ accountId });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
        ✓ Opp created
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-md bg-service-fs px-3 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-60 sm:text-xs"
      >
        {isPending ? "Creating…" : "Create FS opp"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
