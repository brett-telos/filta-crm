"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  updateAccountAction,
  type AccountStatusNotesState,
} from "./actions";

type Props = {
  accountId: string;
  accountStatus: "prospect" | "customer" | "churned" | "do_not_contact";
  notes: string | null;
};

export default function StatusNotesForm({
  accountId,
  accountStatus,
  notes,
}: Props) {
  const initial: AccountStatusNotesState = {};
  const [state, formAction] = useFormState(updateAccountAction, initial);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state.ok) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-3 text-sm">
      <input type="hidden" name="accountId" value={accountId} />
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Status</span>
        <select
          name="accountStatus"
          defaultValue={accountStatus}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value="prospect">Prospect</option>
          <option value="customer">Customer</option>
          <option value="churned">Churned</option>
          <option value="do_not_contact">Do Not Contact</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Notes</span>
        <textarea
          name="notes"
          rows={4}
          defaultValue={notes ?? ""}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </label>

      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {showSaved ? (
          <span className="text-xs font-medium text-emerald-700">
            ✓ Saved
          </span>
        ) : null}
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-filta-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-filta-blue-dark disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
