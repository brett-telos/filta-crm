"use client";

// Editable contact / address / company info card. Toggles between a compact
// read view and a form. Wraps the updateAccountInfoAction server action via
// useFormState so we can show inline errors and reset back to view mode on
// a successful save.

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  updateAccountInfoAction,
  type AccountInfoState,
} from "./actions";
import {
  INDUSTRY_LABEL,
  LEAD_SOURCE_LABEL,
  formatPhone,
} from "@/lib/format";

type AccountInfo = {
  id: string;
  companyName: string;
  dbaName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  phone: string | null;
  website: string | null;
  industrySegment: string | null;
  leadSource: string;
  fryerCount: number | null;
  ncaFlag: boolean;
  ncaName: string | null;
};

export default function EditableInfoCard({ acct }: { acct: AccountInfo }) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Company &amp; location
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
        <ReadView acct={acct} />
      ) : (
        <InfoForm acct={acct} onDone={() => setEditing(false)} />
      )}
    </section>
  );
}

// Form is its own component so useFormState gets a fresh `{}` initial state
// every time the user re-opens the edit panel (otherwise a previous save's
// `state.ok=true` would immediately close the form on re-open).
function InfoForm({
  acct,
  onDone,
}: {
  acct: AccountInfo;
  onDone: () => void;
}) {
  const [ncaOn, setNcaOn] = useState(acct.ncaFlag);
  const initial: AccountInfoState = {};
  const [state, formAction] = useFormState(updateAccountInfoAction, initial);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-3 text-sm">
          <input type="hidden" name="accountId" value={acct.id} />

          <Field label="Company name" required>
            <input
              name="companyName"
              defaultValue={acct.companyName}
              required
              className={inputCls}
            />
          </Field>

          <Field label="DBA (doing business as)">
            <input
              name="dbaName"
              defaultValue={acct.dbaName ?? ""}
              className={inputCls}
            />
          </Field>

          <Field label="Address line 1">
            <input
              name="addressLine1"
              defaultValue={acct.addressLine1 ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Address line 2">
            <input
              name="addressLine2"
              defaultValue={acct.addressLine2 ?? ""}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-6 gap-2">
            <div className="col-span-3">
              <Field label="City">
                <input
                  name="city"
                  defaultValue={acct.city ?? ""}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="col-span-1">
              <Field label="State">
                <input
                  name="state"
                  maxLength={2}
                  defaultValue={acct.state ?? "FL"}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="ZIP">
                <input
                  name="zip"
                  defaultValue={acct.zip ?? ""}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          <Field label="County">
            <input
              name="county"
              defaultValue={acct.county ?? ""}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone">
              <input
                name="phone"
                defaultValue={acct.phone ?? ""}
                placeholder="(555) 555-5555"
                className={inputCls}
              />
            </Field>
            <Field label="Website">
              <input
                name="website"
                defaultValue={acct.website ?? ""}
                placeholder="example.com"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Industry">
              <select
                name="industrySegment"
                defaultValue={acct.industrySegment ?? ""}
                className={inputCls}
              >
                <option value="">—</option>
                {Object.entries(INDUSTRY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lead source">
              <select
                name="leadSource"
                defaultValue={acct.leadSource}
                className={inputCls}
              >
                {Object.entries(LEAD_SOURCE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Fryer count">
            <input
              name="fryerCount"
              type="number"
              min={0}
              max={500}
              defaultValue={acct.fryerCount ?? ""}
              className={inputCls}
            />
          </Field>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="ncaFlag"
                defaultChecked={acct.ncaFlag}
                onChange={(e) => setNcaOn(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="font-medium">National Chain Account (NCA)</span>
            </label>
            {ncaOn ? (
              <div className="mt-2">
                <Field label="NCA name (e.g. Sodexo, Compass)">
                  <input
                    name="ncaName"
                    defaultValue={acct.ncaName ?? ""}
                    className={inputCls}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          {state.error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <SaveButton />
          </div>
    </form>
  );
}

function ReadView({ acct }: { acct: AccountInfo }) {
  const cityLine = [acct.city, acct.state, acct.zip].filter(Boolean).join(", ");
  return (
    <dl className="space-y-2 text-sm">
      <Row label="Company">
        <span className="font-medium text-slate-900">{acct.companyName}</span>
        {acct.dbaName ? (
          <span className="ml-2 text-slate-500">dba {acct.dbaName}</span>
        ) : null}
      </Row>

      <Row label="Address">
        <div className="text-slate-700">
          {acct.addressLine1 ? <div>{acct.addressLine1}</div> : null}
          {acct.addressLine2 ? <div>{acct.addressLine2}</div> : null}
          {cityLine ? <div>{cityLine}</div> : null}
          {acct.county ? (
            <div className="text-xs text-slate-500">{acct.county} County</div>
          ) : null}
          {!acct.addressLine1 && !cityLine ? (
            <span className="text-slate-400">—</span>
          ) : null}
        </div>
      </Row>

      <Row label="Phone">
        {acct.phone ? (
          <a
            href={`tel:${acct.phone}`}
            className="text-slate-700 hover:underline"
          >
            {formatPhone(acct.phone)}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </Row>

      <Row label="Website">
        {acct.website ? (
          <a
            href={
              acct.website.startsWith("http")
                ? acct.website
                : `https://${acct.website}`
            }
            target="_blank"
            rel="noreferrer"
            className="text-slate-700 underline"
          >
            {acct.website}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </Row>

      <Row label="Industry">
        <span className="text-slate-700">
          {acct.industrySegment
            ? INDUSTRY_LABEL[acct.industrySegment] ?? acct.industrySegment
            : "—"}
        </span>
      </Row>

      <Row label="Lead source">
        <span className="text-slate-700">
          {LEAD_SOURCE_LABEL[acct.leadSource] ?? acct.leadSource}
        </span>
      </Row>

      <Row label="Fryers">
        <span className="text-slate-700">
          {acct.fryerCount != null ? acct.fryerCount : "—"}
        </span>
      </Row>

      {acct.ncaFlag ? (
        <Row label="NCA">
          <span className="text-slate-700">{acct.ncaName ?? "Yes"}</span>
        </Row>
      ) : null}
    </dl>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </span>
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
