"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  updateAccountStatusAction,
  logActivityAction,
  type AccountStatusState,
  type LogState,
} from "./actions";
import { formatDateTime, formatRelative } from "@/lib/format";

type NoteEntry = {
  id: string;
  body: string | null;
  occurredAt: Date | string;
  ownerFirstName: string | null;
  ownerEmail: string | null;
};

type Props = {
  accountId: string;
  accountStatus: "prospect" | "customer" | "churned" | "do_not_contact";
  legacyNote: string | null;
  notes: NoteEntry[];
};

export default function StatusNotesForm({
  accountId,
  accountStatus,
  legacyNote,
  notes,
}: Props) {
  return (
    <div className="space-y-5">
      <StatusForm accountId={accountId} accountStatus={accountStatus} />

      <div className="border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Notes
        </h3>
        <NoteForm accountId={accountId} />
        <NoteHistory notes={notes} legacyNote={legacyNote} />
      </div>
    </div>
  );
}

// ---------- Status select ---------------------------------------------------

function StatusForm({
  accountId,
  accountStatus,
}: {
  accountId: string;
  accountStatus: Props["accountStatus"];
}) {
  const initial: AccountStatusState = {};
  const [state, formAction] = useFormState(
    updateAccountStatusAction,
    initial,
  );
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state.ok) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state.ok]);

  return (
    <form action={formAction} className="space-y-2 text-sm">
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
        <SaveButton label="Update status" />
      </div>
    </form>
  );
}

// ---------- Add note (writes an activity row of type='note') ---------------

function NoteForm({ accountId }: { accountId: string }) {
  const initial: LogState = {};
  const [state, formAction] = useFormState(logActivityAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [showSaved, setShowSaved] = useState(false);

  // Reset the textarea after a successful save and show a brief
  // confirmation. The new note will appear in the history list below
  // because the page revalidates on save.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2 text-sm">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="type" value="note" />
      <input type="hidden" name="direction" value="na" />
      <textarea
        name="body"
        rows={3}
        required
        placeholder="Add a note…"
        className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {showSaved ? (
          <span className="text-xs font-medium text-emerald-700">
            ✓ Note saved
          </span>
        ) : null}
        <SaveButton label="Save note" />
      </div>
    </form>
  );
}

// ---------- Past notes list -------------------------------------------------

function NoteHistory({
  notes,
  legacyNote,
}: {
  notes: NoteEntry[];
  legacyNote: string | null;
}) {
  const hasLegacy = !!(legacyNote && legacyNote.trim().length > 0);
  if (notes.length === 0 && !hasLegacy) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        History
      </h4>
      <ul className="space-y-2">
        {notes.map((n) => {
          const who =
            n.ownerFirstName ||
            n.ownerEmail?.split("@")[0] ||
            "Unknown";
          const occurred = new Date(n.occurredAt);
          return (
            <li
              key={n.id}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span className="font-medium text-slate-700">{who}</span>
                <span title={formatDateTime(occurred)}>
                  {formatRelative(occurred)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-800">
                {n.body}
              </p>
            </li>
          );
        })}

        {hasLegacy ? (
          <li className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-2">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Legacy note
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {legacyNote}
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// ---------- Shared save button ---------------------------------------------

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-filta-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-filta-blue-dark disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}
