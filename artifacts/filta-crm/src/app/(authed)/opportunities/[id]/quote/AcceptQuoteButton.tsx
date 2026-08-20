"use client";

// "Mark accepted" button for sent quote versions. Calls acceptQuoteAction
// which generates the Service Agreement PDF, emails it, flips the account
// to customer, advances the opp to closed_won, and creates a "Schedule
// first visit" task. window.confirm() guards against accidental clicks
// since the action has wide blast radius (account/opp status changes).
//
// Renders in three states:
//   - default: blue "Mark accepted" button
//   - pending: "Working…" with disabled style
//   - done:    green pill "✓ Accepted — agreement sent" with download link

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptQuoteAction } from "../../../quotes/actions";

type Props = {
  quoteVersionId: string;
  customerName: string;
  customerEmail: string | null;
};

export default function AcceptQuoteButton({
  quoteVersionId,
  customerName,
  customerEmail,
}: Props) {
  const [accepted, setAccepted] = useState<{
    serviceAgreementId?: string;
    devStub?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    setError(null);
    if (!customerEmail) {
      setError("No contact email on file — required to send the agreement.");
      return;
    }
    const ok = window.confirm(
      `Mark this quote accepted?\n\nThis will:\n` +
        `• Generate a Service Agreement PDF\n` +
        `• Email it to ${customerEmail}\n` +
        `• Flip ${customerName} to a customer\n` +
        `• Close the opportunity as won\n` +
        `• Create a "Schedule first visit" task for tomorrow\n\n` +
        `Continue?`,
    );
    if (!ok) return;

    startTransition(async () => {
      const res = await acceptQuoteAction({ quoteVersionId });
      if (!res.ok) {
        setError(res.error ?? "Acceptance failed");
        return;
      }
      setAccepted({
        serviceAgreementId: res.serviceAgreementId,
        devStub: res.devStub,
      });
      router.refresh();
    });
  }

  if (accepted) {
    return (
      <div className="flex flex-col gap-1 text-right">
        <span className="inline-flex items-center justify-end rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
          ✓ Accepted — agreement sent
          {accepted.devStub ? " (dev stub)" : ""}
        </span>
        {accepted.serviceAgreementId ? (
          <a
            href={`/api/agreements/${accepted.serviceAgreementId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-filta-blue hover:underline"
          >
            Download agreement PDF →
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-[32px] items-center justify-center whitespace-nowrap rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Working…" : "Mark accepted"}
      </button>
      {error ? (
        <span className="max-w-[200px] text-right text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}
