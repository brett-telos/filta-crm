"use client";

// Invite-user form. Plain HTML form + a small useTransition wrapper for
// the loading state. On success: clears the inputs and shows a success
// pill. On dev-stub mode (no Resend key): exposes the reset link inline
// so the admin can copy/paste it to the invitee out-of-band.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteUserAction } from "./actions";

const ROLES: Array<{ value: "admin" | "sales_rep" | "technician"; label: string }> = [
  { value: "sales_rep", label: "Sales Rep" },
  { value: "admin", label: "Admin" },
  { value: "technician", label: "Technician" },
];

const TERRITORIES: Array<{
  value: "fun_coast" | "space_coast" | "both";
  label: string;
}> = [
  { value: "fun_coast", label: "Fun Coast" },
  { value: "space_coast", label: "Space Coast" },
  { value: "both", label: "Both" },
];

export default function InviteUserForm() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"admin" | "sales_rep" | "technician">(
    "sales_rep",
  );
  const [territory, setTerritory] = useState<
    "fun_coast" | "space_coast" | "both"
  >("both");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    email: string;
    devLink?: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await inviteUserAction({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        territory,
      });
      if (!res.ok) {
        setError(res.error ?? "Invite failed");
        return;
      }
      setSuccess({
        email: email.trim(),
        devLink: res.resetLinkForDev,
      });
      // Clear the form so admin can invite the next person quickly.
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("sales_rep");
      setTerritory("both");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            placeholder="teammate@filta.example"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-filta-blue focus:outline-none focus:ring-1 focus:ring-filta-blue"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">First name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-filta-blue focus:outline-none focus:ring-1 focus:ring-filta-blue"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Last name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-filta-blue focus:outline-none focus:ring-1 focus:ring-filta-blue"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Territory</span>
          <select
            value={territory}
            onChange={(e) => setTerritory(e.target.value as typeof territory)}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            {TERRITORIES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-[38px] items-center rounded-md bg-filta-blue px-4 text-sm font-semibold text-white hover:bg-filta-blue-dark disabled:opacity-60"
          >
            {isPending ? "Inviting…" : "Send invite"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          ✓ Invited <strong>{success.email}</strong> — they&apos;ll receive
          a set-password link by email.
          {success.devLink ? (
            <>
              <div className="mt-2 text-xs">
                Dev mode (no email API key set) — copy this link to the
                invitee directly:
              </div>
              <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">
                {success.devLink}
              </code>
            </>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
