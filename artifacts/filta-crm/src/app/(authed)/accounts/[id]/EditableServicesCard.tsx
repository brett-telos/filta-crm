"use client";

// Editable services card. Lets users toggle each Filta service line on/off
// for the account, set a monthly revenue, and record the last service date.
// Stored as JSONB on accounts.service_profile.

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  updateServiceProfileAction,
  type ServiceProfileState,
} from "./actions";
import { SERVICE_LABEL, formatCurrency } from "@/lib/format";

const SERVICE_KEYS = ["ff", "fs", "fb", "fg", "fc", "fd"] as const;
type ServiceKey = (typeof SERVICE_KEYS)[number];

type Entry = {
  active?: boolean;
  monthly_revenue?: number;
  last_service_date?: string;
};

type Props = {
  accountId: string;
  serviceProfile: Record<string, Entry>;
};

export default function EditableServicesCard({
  accountId,
  serviceProfile,
}: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Services
        </h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
        ) : null}
      </div>

      {!editing ? (
        <div className="space-y-2 text-sm">
          {SERVICE_KEYS.map((k) => {
            const entry = serviceProfile?.[k] ?? {};
            const active = entry?.active === true;
            const rev = Number(entry?.monthly_revenue ?? 0);
            return (
              <div
                key={k}
                className="flex items-center justify-between border-b border-slate-100 pb-1 last:border-0"
              >
                <div>
                  <div className="font-medium text-slate-900">
                    {SERVICE_LABEL[k]}
                  </div>
                  <div className="text-xs uppercase text-slate-500">
                    {active ? "Active" : "—"}
                  </div>
                </div>
                <div className="text-right text-sm">
                  {active ? (
                    <>
                      <div className="font-medium text-slate-900">
                        {formatCurrency(rev)}/mo
                      </div>
                      {entry.last_service_date ? (
                        <div className="text-xs text-slate-500">
                          Last: {entry.last_service_date}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ServicesForm
          accountId={accountId}
          serviceProfile={serviceProfile}
          onDone={() => setEditing(false)}
        />
      )}
    </section>
  );
}

// Form lives in its own component so useFormState reinitializes to `{}` on
// every re-open of the edit panel.
function ServicesForm({
  accountId,
  serviceProfile,
  onDone,
}: {
  accountId: string;
  serviceProfile: Record<string, Entry>;
  onDone: () => void;
}) {
  const initial: ServiceProfileState = {};
  const [state, formAction] = useFormState(updateServiceProfileAction, initial);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-3 text-sm">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="space-y-3">
        {SERVICE_KEYS.map((k) => (
          <ServiceRow key={k} k={k} entry={serviceProfile?.[k] ?? {}} />
        ))}
      </div>

      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <SaveButton />
      </div>
    </form>
  );
}

function ServiceRow({ k, entry }: { k: ServiceKey; entry: Entry }) {
  const [active, setActive] = useState(entry?.active === true);
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <label className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{SERVICE_LABEL[k]}</span>
        <span className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            name={`svc_${k}_active`}
            defaultChecked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Active
        </span>
      </label>

      {active ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-slate-600">Monthly revenue</span>
            <input
              name={`svc_${k}_revenue`}
              type="number"
              min={0}
              step="0.01"
              defaultValue={entry?.monthly_revenue ?? ""}
              placeholder="0.00"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Last service</span>
            <input
              name={`svc_${k}_last`}
              type="date"
              defaultValue={entry?.last_service_date ?? ""}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </label>
        </div>
      ) : (
        // Keep the fields in the form so the value posts even when inactive
        // (we still want to clear them if the user just turned the row off).
        <>
          <input type="hidden" name={`svc_${k}_revenue`} value="" />
          <input type="hidden" name={`svc_${k}_last`} value="" />
        </>
      )}
    </div>
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
