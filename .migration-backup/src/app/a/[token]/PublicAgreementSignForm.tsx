"use client";

// Customer-facing typed-name signature form on /a/[token]. On submit:
//   - Validates the typed name is non-empty and matches the affirmation
//     checkbox state.
//   - Calls signAgreementPublicAction which stamps the agreement as
//     signed, captures audit context (IP, user-agent), and notifies the
//     rep via activity.
//   - Renders a success state inline.
//
// Intentionally simple. v1 = typed-name e-signature, which is the
// minimum-viable enforceable form under E-SIGN Act / UETA when paired
// with the affirmation checkbox. v2 can swap in DocuSign / Dropbox Sign
// without changing this UI shape.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signAgreementPublicAction } from "./actions";

export default function PublicAgreementSignForm({
  token,
  companyName,
  defaultName,
}: {
  token: string;
  companyName: string;
  defaultName: string;
}) {
  const [typedName, setTypedName] = useState(defaultName);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!typedName.trim()) {
      setError("Please type your full name to sign.");
      return;
    }
    if (!agreed) {
      setError(
        "Please confirm that typing your name constitutes your signature.",
      );
      return;
    }

    startTransition(async () => {
      const res = await signAgreementPublicAction({
        token,
        signedName: typedName.trim(),
      });
      if (!res.ok) {
        setError(res.error ?? "Signing failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3 text-sm font-semibold text-slate-900">
        Sign for {companyName}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-600">
          Your full name
        </span>
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="e.g. Pat Garcia"
          autoComplete="name"
          required
          disabled={isPending}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </label>

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span>
          I agree that typing my name above and clicking Sign constitutes
          my electronic signature on this Service Agreement, and that I
          have read and accept the terms.
        </span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 sm:w-auto"
      >
        {isPending ? "Signing…" : "Sign Service Agreement"}
      </button>

      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}

      <p className="mt-3 text-xs text-slate-500">
        We&apos;ll capture the date, time, your IP address, and your typed
        name as the signature record. A signed copy will be emailed to
        you immediately.
      </p>
    </form>
  );
}
