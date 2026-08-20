"use client";

// One-click "Send FS cross-sell email" button for the cross-sell dashboard.
//
// Behavior:
//  - Confirm before sending so a slip of the hand doesn't fire an email.
//    Confirmation is cheap here (window.confirm) — can be upgraded to a modal
//    once we have a shared one.
//  - Shows "Sending…" during the network call.
//  - On success, replaces itself with a small green pill showing where the
//    email went and a hint that a 5-day follow-up was auto-created.
//  - Dev stub (no RESEND_API_KEY) is shown inline so it's obvious during
//    local iteration that nothing actually went out.
//  - On failure, surfaces the error underneath the button and leaves it
//    clickable for a retry.
//
// Disabled state when the row has no contact email — we disable the button
// and show a muted reason so the rep knows it's a data problem, not a bug.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendFsCrossSellEmailAction } from "./actions";

type Props = {
  accountId: string;
  companyName: string;
  // If null/empty, we render a disabled state instead of a clickable button.
  contactEmail: string | null;
};

export default function SendEmailButton({
  accountId,
  companyName,
  contactEmail,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState<{
    email: string;
    devStub: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const hasEmail = !!contactEmail && contactEmail.trim().length > 0;

  function handleClick() {
    setError(null);
    const ok = window.confirm(
      `Send the FiltaClean cross-sell email to ${companyName} (${contactEmail})?`,
    );
    if (!ok) return;

    startTransition(async () => {
      const res = await sendFsCrossSellEmailAction({ accountId });
      if (!res.ok) {
        setError(res.error ?? "Send failed");
        return;
      }
      setSent({ email: contactEmail ?? "", devStub: !!res.devStub });
      // Refresh the server-rendered page so the sent-email history card on
      // the account detail + any other server data is fresh.
      router.refresh();
    });
  }

  if (!hasEmail) {
    return (
      <span
        className="inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500"
        title="Add a contact with an email on this account to enable sending."
      >
        No email on file
      </span>
    );
  }

  if (sent) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
          ✓ Email sent
        </span>
        <span className="text-[10px] text-slate-500">
          {sent.devStub ? "(dev stub — no API key set)" : "Follow-up in 5 days"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-md border border-filta-blue bg-white px-3 py-2 text-xs font-semibold text-filta-blue shadow-sm hover:bg-filta-light-blue disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Send FS email"}
      </button>
      {error ? (
        <span className="max-w-[160px] text-right text-xs text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}
