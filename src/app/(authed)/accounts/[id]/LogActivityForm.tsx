"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { logActivityAction, type LogState } from "./actions";

const initialState: LogState = {};

const TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "visit", label: "Site Visit" },
  { value: "note", label: "Note" },
  { value: "task", label: "Task" },
];

const DISPOSITIONS = [
  { value: "", label: "(none)" },
  { value: "connected", label: "Connected" },
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "no_answer", label: "No answer" },
  { value: "callback_scheduled", label: "Callback scheduled" },
  { value: "site_eval_booked", label: "Site eval booked" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "number_disconnected", label: "Number disconnected" },
  { value: "dnc", label: "Do not contact" },
];

export default function LogActivityForm({ accountId }: { accountId: string }) {
  const [state, formAction] = useFormState(logActivityAction, initialState);
  const [type, setType] = useState("call");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setType("call");
    }
  }, [state.ok]);

  const showDisposition = type === "call";

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="accountId" value={accountId} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Type</span>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-600">Direction</span>
          <select
            name="direction"
            defaultValue="outbound"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm"
          >
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
            <option value="na">N/A</option>
          </select>
        </label>

        {showDisposition ? (
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Result</span>
            <select
              name="disposition"
              defaultValue=""
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm"
            >
              {DISPOSITIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-xs font-medium text-slate-600">
              Duration (min)
            </span>
            <input
              type="number"
              name="durationMinutes"
              min={0}
              max={600}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm"
            />
          </label>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-600">Subject</span>
        <input
          type="text"
          name="subject"
          placeholder={
            type === "call" ? "e.g. Intro call to Chef Marco" : "Short summary"
          }
          maxLength={200}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-slate-600">Notes</span>
        <textarea
          name="body"
          rows={3}
          maxLength={4000}
          placeholder="What did you cover? Next steps?"
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </label>

      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      ) : null}
      {state.ok ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Logged.
        </div>
      ) : null}

      <div className="flex sm:justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  // Full-width on mobile (~44px min height for tap targets), auto width from sm↑.
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-filta-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-filta-blue-dark disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Logging…" : "Log activity"}
    </button>
  );
}
