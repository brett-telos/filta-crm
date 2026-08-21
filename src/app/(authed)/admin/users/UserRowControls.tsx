"use client";

// Per-row inline controls for /admin/users — role select, territory
// select, active toggle, resend invite. Each one is its own tiny client
// component so the table row stays a server-rendered <tr>; only the
// individual controls hydrate.
//
// Each control is exported by name. Import as
//   import { RoleSelect, TerritorySelect, ActiveToggle, ResendInvite } from "./UserRowControls";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resendInviteAction, updateUserAction } from "./actions";

export function RoleSelect({
  userId,
  value,
  disabledForSelf,
}: {
  userId: string;
  value: string;
  disabledForSelf?: boolean;
}) {
  const [v, setV] = useState(value);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleChange(next: string) {
    if (next === v) return;
    setError(null);
    const previous = v;
    setV(next);
    startTransition(async () => {
      const res = await updateUserAction({
        userId,
        role: next as "admin" | "sales_rep" | "technician",
      });
      if (!res.ok) {
        setV(previous);
        setError(res.error ?? "Update failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <select
        value={v}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending || disabledForSelf}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-60"
        title={disabledForSelf ? "You can't demote yourself out of admin" : undefined}
      >
        <option value="admin">Admin</option>
        <option value="sales_rep">Sales Rep</option>
        <option value="technician">Technician</option>
      </select>
      {error ? <div className="mt-0.5 text-[10px] text-red-700">{error}</div> : null}
    </div>
  );
}

export function TerritorySelect({
  userId,
  value,
}: {
  userId: string;
  value: string;
}) {
  const [v, setV] = useState(value);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleChange(next: string) {
    if (next === v) return;
    setError(null);
    const previous = v;
    setV(next);
    startTransition(async () => {
      const res = await updateUserAction({
        userId,
        territory: next as "fun_coast" | "space_coast" | "both",
      });
      if (!res.ok) {
        setV(previous);
        setError(res.error ?? "Update failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <select
        value={v}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
      >
        <option value="fun_coast">Fun Coast</option>
        <option value="space_coast">Space Coast</option>
        <option value="both">Both</option>
      </select>
      {error ? <div className="mt-0.5 text-[10px] text-red-700">{error}</div> : null}
    </div>
  );
}

export function ActiveToggle({
  userId,
  active,
  disabledForSelf,
}: {
  userId: string;
  active: boolean;
  disabledForSelf?: boolean;
}) {
  const [v, setV] = useState(active);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleToggle() {
    setError(null);
    const next = !v;
    if (!next && disabledForSelf) {
      setError("You can't deactivate yourself");
      return;
    }
    if (
      !next &&
      !window.confirm(
        "Deactivate this user? They won't be able to log in until reactivated. Their data is preserved.",
      )
    ) {
      return;
    }
    const previous = v;
    setV(next);
    startTransition(async () => {
      const res = await updateUserAction({ userId, active: next });
      if (!res.ok) {
        setV(previous);
        setError(res.error ?? "Update failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending || disabledForSelf}
        title={
          disabledForSelf
            ? "You can't deactivate yourself"
            : v
              ? "Click to deactivate"
              : "Click to reactivate"
        }
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-60 ${
          v
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
        }`}
      >
        {v ? "✓ Active" : "Inactive"}
      </button>
      {error ? <div className="mt-0.5 text-[10px] text-red-700">{error}</div> : null}
    </div>
  );
}

export function ResendInvite({ userId }: { userId: string }) {
  const [state, setState] = useState<
    null | { ok: true; devLink?: string } | { ok: false; error: string }
  >(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    setState(null);
    startTransition(async () => {
      const res = await resendInviteAction({ userId });
      if (!res.ok) {
        setState({ ok: false, error: res.error ?? "Resend failed" });
        return;
      }
      setState({ ok: true, devLink: res.resetLinkForDev });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Resend invite"}
      </button>
      {state?.ok ? (
        <span className="text-[10px] text-emerald-700">
          ✓ Sent
          {state.devLink ? " (dev — link below)" : ""}
        </span>
      ) : null}
      {state?.ok && state.devLink ? (
        <code className="max-w-[300px] truncate rounded bg-slate-50 px-1 py-0.5 text-[10px] text-slate-700">
          {state.devLink}
        </code>
      ) : null}
      {state && !state.ok ? (
        <span className="max-w-[200px] text-right text-[10px] text-red-700">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

// Each control is a named export above; the page imports them directly
// rather than through a namespace object — keeps the RSC boundary boring.
