"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { forgotPasswordAction, type ForgotState } from "./actions";

const initialState: ForgotState = {};

export default function ForgotForm() {
  const [state, formAction] = useFormState(forgotPasswordAction, initialState);

  if (state.submitted) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
          If an account exists for that email, a password reset link has been
          generated. Until email delivery is wired up, the link is written to
          the server log — ask an admin.
        </div>
        <Link
          href="/login"
          className="block text-center text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </div>
      ) : null}

      <SubmitButton />

      <Link
        href="/login"
        className="block text-center text-sm text-slate-600 hover:text-slate-900"
      >
        ← Back to sign in
      </Link>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full min-h-[44px] rounded-md bg-filta-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-filta-blue-dark focus:outline-none focus:ring-2 focus:ring-filta-blue focus:ring-offset-2 disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send reset link"}
    </button>
  );
}
