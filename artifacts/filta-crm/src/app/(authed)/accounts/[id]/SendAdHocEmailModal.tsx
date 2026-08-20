"use client";

// Compose modal for the account-detail "Email" button. Replaces the old
// mailto: link so the email actually flows through the CRM's Resend
// pipeline — meaning it gets logged in email_sends, written to the
// activity timeline, and tracked for opens / clicks / replies via the
// W4.1 webhook chain. Same shape as the cross-sell + quote send flows.
//
// What the modal does:
//   - Picks the recipient contact (defaults to primary; dropdown if
//     multiple have an email)
//   - Optional template prefill (pulls active 'general_followup' /
//     'other' purpose templates; selecting one fills subject + body)
//   - Plain-text body — placeholders {{firstName}} / {{companyName}} /
//     {{senderFirstName}} substitute server-side
//   - Send button with confirm + loading + success / error states
//
// Body intentionally stays plain text in v1. The server wraps each
// paragraph in <p> + <br> for line breaks, then in the brand HTML shell.
// Rich-text comes later if reps actually need it.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendAdHocAccountEmailAction } from "./actions";

export type ComposeContact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string;
  isPrimary: boolean;
};

export type ComposeTemplate = {
  id: string;
  name: string;
  subjectTemplate: string;
  bodyTextTemplate: string;
};

type Props = {
  accountId: string;
  companyName: string;
  contacts: ComposeContact[];
  templates: ComposeTemplate[];
  /** Triggered by the parent button. Modal is closed when null. */
  open: boolean;
  onClose: () => void;
};

export default function SendAdHocEmailModal({
  accountId,
  companyName,
  contacts,
  templates,
  open,
  onClose,
}: Props) {
  // Default to primary contact, falling back to the first contact in the
  // list (we already filtered to email-having contacts in the parent).
  const defaultContactId = useMemo(() => {
    return (
      contacts.find((c) => c.isPrimary)?.id ?? contacts[0]?.id ?? ""
    );
  }, [contacts]);

  const [contactId, setContactId] = useState(defaultContactId);
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ devStub?: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  // Reset modal state on each open.
  useEffect(() => {
    if (open) {
      setContactId(defaultContactId);
      setTemplateId("");
      setSubject("");
      setBody("");
      setError(null);
      setSuccess(null);
      // Focus the subject so a rep can start typing immediately.
      setTimeout(() => subjectRef.current?.focus(), 50);
    }
  }, [open, defaultContactId]);

  // Template prefill — selecting a template overwrites the subject and
  // body. We don't try to merge with whatever the rep has typed; if they
  // pick a template they presumably want it.
  function handleTemplateChange(nextId: string) {
    setTemplateId(nextId);
    if (!nextId) return;
    const tpl = templates.find((t) => t.id === nextId);
    if (!tpl) return;
    setSubject(tpl.subjectTemplate);
    setBody(tpl.bodyTextTemplate);
  }

  function handleSend() {
    setError(null);
    if (!contactId) {
      setError("Pick a recipient.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!body.trim()) {
      setError("Body is required.");
      return;
    }

    const recipient = contacts.find((c) => c.id === contactId);
    const ok = window.confirm(
      `Send this email to ${recipient?.fullName ?? recipient?.email ?? "the contact"}?`,
    );
    if (!ok) return;

    startTransition(async () => {
      const res = await sendAdHocAccountEmailAction({
        accountId,
        contactId,
        templateId: templateId || null,
        subject: subject.trim(),
        body,
      });
      if (!res.ok) {
        setError(res.error ?? "Send failed");
        return;
      }
      setSuccess({ devStub: res.devStub });
      router.refresh();
    });
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-email-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 px-3 py-6 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        // Click the backdrop to close — but only the backdrop itself, not
        // children (e.g. the modal card).
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-baseline justify-between border-b border-slate-100 px-5 py-3">
          <h2
            id="send-email-title"
            className="text-base font-semibold text-slate-900"
          >
            Email {companyName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="text-xl leading-none text-slate-400 hover:text-slate-700 disabled:opacity-60"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {success ? (
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              ✓ Email sent
              {success.devStub
                ? " (dev stub — no Resend API key set)"
                : null}
              . It&apos;ll appear on the &quot;Emails sent&quot; card with
              opens / clicks tracked once webhooks fire.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-filta-blue px-4 py-2 text-sm font-semibold text-white hover:bg-filta-blue-dark"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {/* Recipient */}
            <label className="block">
              <span className="text-xs font-medium text-slate-600">To</span>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                disabled={isPending}
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
              >
                {contacts.length === 0 ? (
                  <option value="">No contact with email</option>
                ) : (
                  contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName ??
                        [c.firstName, c.lastName].filter(Boolean).join(" ") ??
                        c.email}{" "}
                      &lt;{c.email}&gt;
                      {c.isPrimary ? " · primary" : ""}
                    </option>
                  ))
                )}
              </select>
            </label>

            {/* Optional template */}
            {templates.length > 0 ? (
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Template (optional)
                </span>
                <select
                  value={templateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  disabled={isPending}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                >
                  <option value="">— Start blank —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">
                  Picking a template overwrites the subject + body.
                </span>
              </label>
            ) : null}

            {/* Subject */}
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Subject
              </span>
              <input
                ref={subjectRef}
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isPending}
                placeholder="Quick check-in"
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
              />
            </label>

            {/* Body */}
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Message
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={isPending}
                rows={8}
                placeholder={
                  "Hi {{firstName}},\n\nWriting to follow up on …\n\nThanks,\n{{senderFirstName}}"
                }
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Plain text. Placeholders{" "}
                <code className="rounded bg-slate-100 px-1">
                  {`{{firstName}}`}
                </code>
                ,{" "}
                <code className="rounded bg-slate-100 px-1">
                  {`{{companyName}}`}
                </code>
                ,{" "}
                <code className="rounded bg-slate-100 px-1">
                  {`{{senderFirstName}}`}
                </code>{" "}
                are substituted server-side. The body gets wrapped in the
                Filta brand shell when sent.
              </span>
            </label>

            {error ? (
              <p className="text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={isPending || contacts.length === 0}
                className="rounded-md bg-filta-blue px-4 py-2 text-sm font-semibold text-white hover:bg-filta-blue-dark disabled:opacity-60"
              >
                {isPending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
