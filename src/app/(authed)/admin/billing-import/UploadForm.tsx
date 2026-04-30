"use client";

// File-upload form for the billing CSV. Calls uploadBillingImportAction;
// on success redirects to the diff preview page for the new row id.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadBillingImportAction } from "./actions";

export default function UploadForm() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Pick a CSV file before uploading.");
      return;
    }

    startTransition(async () => {
      const res = await uploadBillingImportAction(fd);
      if (!res.ok) {
        setError(res.error ?? "Upload failed");
        return;
      }
      if (res.billingImportId) {
        router.push(`/admin/billing-import/${res.billingImportId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-[260px]">
        <span className="text-xs font-medium text-slate-600">CSV file</span>
        <input
          ref={fileInputRef}
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-[38px] items-center rounded-md bg-filta-blue px-4 text-sm font-semibold text-white hover:bg-filta-blue-dark disabled:opacity-60"
      >
        {isPending ? "Uploading…" : "Upload + preview diff"}
      </button>
      {error ? (
        <p className="basis-full text-sm text-red-700">{error}</p>
      ) : null}
    </form>
  );
}
