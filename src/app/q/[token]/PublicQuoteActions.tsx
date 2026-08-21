"use client";

// Customer-facing Accept / Decline buttons on /q/[token]. Both go through
// confirmation prompts because they're irreversible from the customer's
// side — accept triggers the agreement email + onboarding flow; decline
// transitions the quote to 'declined' status and notifies the rep.
//
// On accept success: redirect to /a/[agreementToken] for immediate
// signature. The action returns the new agreement's token so we don't
// have to round-trip through email if the customer wants to sign right
// away.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptQuotePublicAction,
  declineQuotePublicAction,
} from "./actions";

export default function PublicQuoteActions({
  token,
  companyName,
  annualValue,
}: {
  token: string;
  companyName: string;
  annualValue: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAccept() {
    setError(null);
    const ok = window.confirm(
      `Accept this proposal for ${companyName}?\n\n` +
        `Estimated annual value: ${annualValue}\n\n` +
        `We'll send the Service Agreement immediately so you can sign and ` +
        `we can schedule your first visit.`,
    );
    if (!ok) return;

    startTransition(async () => {
      const res = await acceptQuotePublicAction({ token });
      if (!res.ok) {
        setError(res.error ?? "Acceptance failed");
        return;
      }
      // If the action returned an agreement sign token, jump straight to
      // /a/[token] for immediate signature. Otherwise stay on the page —
      // the email is on its way.
      if (res.agreementToken) {
        router.push(`/a/${encodeURIComponent(res.agreementToken)}`);
      } else {
        router.refresh();
      }
    });
  }

  function handleDecline() {
    setError(null);
    const reason = window.prompt(
      `Decline this proposal? (Optional: tell us why so we can do better next time)`,
      "",
    );
    if (reason === null) return;

    startTransition(async () => {
      const res = await declineQuotePublicAction({
        token,
        reason: reason || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Decline failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-slate-900">
        Ready to move forward?
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={isPending}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 sm:flex-none"
        >
          {isPending ? "Working…" : `Accept proposal for ${annualValue}/yr`}
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={isPending}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Not right now
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        After acceptance you&apos;ll get the Service Agreement to sign, and
        we&apos;ll schedule your first visit within a week.
      </p>
    </div>
  );
}
