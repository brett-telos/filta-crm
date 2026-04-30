"use client";

// Editable contacts card. Lists the people on this account and lets users
// edit each one inline, add a new one, or remove one. Server actions handle
// the writes; this component manages which row is in edit mode.

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  upsertContactAction,
  deleteContactAction,
  type ContactState,
} from "./actions";
import {
  DECISION_MAKER_ROLE_LABEL,
  PREFERRED_CHANNEL_LABEL,
  formatPhone,
} from "@/lib/format";

export type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title: string | null;
  email: string | null;
  phoneDirect: string | null;
  phoneMobile: string | null;
  decisionMakerRole: string | null;
  preferredChannel: string | null;
  isPrimary: boolean;
};

export default function EditableContactsCard({
  accountId,
  contacts,
}: {
  accountId: string;
  contacts: ContactRow[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Contacts
        </h2>
        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add
          </button>
        ) : null}
      </div>

      {contacts.length === 0 && !adding ? (
        <p className="text-sm text-slate-500">No contacts yet.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {contacts.map((c) =>
            editingId === c.id ? (
              <li key={c.id}>
                <ContactForm
                  accountId={accountId}
                  contact={c}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={c.id}
                className="rounded-md border border-slate-100 p-2 hover:border-slate-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <ContactDisplay c={c} />
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setAdding(false);
                    }}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ),
          )}
          {adding ? (
            <li>
              <ContactForm
                accountId={accountId}
                contact={null}
                onDone={() => setAdding(false)}
              />
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function ContactDisplay({ c }: { c: ContactRow }) {
  const name =
    c.fullName ||
    `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
    "—";
  return (
    <div className="min-w-0">
      <div className="font-medium text-slate-900">
        {name}
        {c.isPrimary ? (
          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
            Primary
          </span>
        ) : null}
      </div>
      {c.title ? <div className="text-xs text-slate-500">{c.title}</div> : null}
      <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-slate-600">
        {c.email ? (
          <a href={`mailto:${c.email}`} className="hover:underline">
            {c.email}
          </a>
        ) : null}
        {c.phoneDirect ? (
          <a href={`tel:${c.phoneDirect}`} className="hover:underline">
            {formatPhone(c.phoneDirect)}
          </a>
        ) : null}
        {c.phoneMobile ? (
          <a href={`tel:${c.phoneMobile}`} className="hover:underline">
            {formatPhone(c.phoneMobile)} (mobile)
          </a>
        ) : null}
      </div>
      {c.decisionMakerRole && c.decisionMakerRole !== "unknown" ? (
        <div className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">
          {DECISION_MAKER_ROLE_LABEL[c.decisionMakerRole] ??
            c.decisionMakerRole}
          {c.preferredChannel
            ? ` · prefers ${
                PREFERRED_CHANNEL_LABEL[c.preferredChannel] ??
                c.preferredChannel
              }`
            : ""}
        </div>
      ) : null}
    </div>
  );
}

function ContactForm({
  accountId,
  contact,
  onDone,
}: {
  accountId: string;
  contact: ContactRow | null;
  onDone: () => void;
}) {
  const initial: ContactState = {};
  const [state, formAction] = useFormState(upsertContactAction, initial);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form
      action={formAction}
      className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <input type="hidden" name="accountId" value={accountId} />
      {contact ? (
        <input type="hidden" name="contactId" value={contact.id} />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Field label="First name">
          <input
            name="firstName"
            defaultValue={contact?.firstName ?? ""}
            className={inputCls}
          />
        </Field>
        <Field label="Last name">
          <input
            name="lastName"
            defaultValue={contact?.lastName ?? ""}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Title">
        <input
          name="title"
          defaultValue={contact?.title ?? ""}
          className={inputCls}
        />
      </Field>

      <Field label="Email">
        <input
          name="email"
          type="email"
          defaultValue={contact?.email ?? ""}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Phone (direct)">
          <input
            name="phoneDirect"
            defaultValue={contact?.phoneDirect ?? ""}
            placeholder="(555) 555-5555"
            className={inputCls}
          />
        </Field>
        <Field label="Phone (mobile)">
          <input
            name="phoneMobile"
            defaultValue={contact?.phoneMobile ?? ""}
            placeholder="(555) 555-5555"
            className={inputCls}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Role">
          <select
            name="decisionMakerRole"
            defaultValue={contact?.decisionMakerRole ?? "unknown"}
            className={inputCls}
          >
            {Object.entries(DECISION_MAKER_ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Preferred channel">
          <select
            name="preferredChannel"
            defaultValue={contact?.preferredChannel ?? ""}
            className={inputCls}
          >
            <option value="">—</option>
            {Object.entries(PREFERRED_CHANNEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isPrimary"
          defaultChecked={contact?.isPrimary ?? false}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span>Primary contact for this account</span>
      </label>

      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div>
          {contact ? (
            <DeleteContact accountId={accountId} contactId={contact.id} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <SaveButton />
        </div>
      </div>
    </form>
  );
}

function DeleteContact({
  accountId,
  contactId,
}: {
  accountId: string;
  contactId: string;
}) {
  return (
    <form
      action={deleteContactAction}
      onSubmit={(e) => {
        if (!confirm("Remove this contact?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="contactId" value={contactId} />
      <button
        type="submit"
        className="text-xs font-medium text-rose-700 hover:text-rose-800 hover:underline"
      >
        Remove
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
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

const inputCls =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
