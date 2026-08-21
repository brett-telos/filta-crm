// /admin/billing-import/[id] — diff preview for a single billing import.
//
// Renders the stored diff_snapshot as four grouped tables (updates,
// no-ops, unmatched, inserts) with per-account before/after MRR and which
// services changed. Apply/Abort actions live in client components below
// the tables.

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, billingImports, users } from "@/db";
import { requireSession } from "@/lib/session";
import type { DiffResult, DiffRow } from "@/lib/billing-csv";
import ApplyAbortButtons from "./ApplyAbortButtons";

export const dynamic = "force-dynamic";

const SERVICE_LABEL: Record<string, string> = {
  ff: "FiltaFry",
  fs: "FiltaClean",
  fb: "FiltaBio",
  fg: "FiltaGold",
  fc: "FiltaCool",
  fd: "FiltaDrain",
};

export default async function BillingImportDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.role !== "admin") notFound();

  const [row] = await db
    .select({
      id: billingImports.id,
      fileName: billingImports.fileName,
      fileHash: billingImports.fileHash,
      uploadedAt: billingImports.uploadedAt,
      appliedAt: billingImports.appliedAt,
      status: billingImports.status,
      rowsTotal: billingImports.rowsTotal,
      accountsUpdated: billingImports.accountsUpdated,
      accountsSkipped: billingImports.accountsSkipped,
      mrrDelta: billingImports.mrrDelta,
      diffSnapshot: billingImports.diffSnapshot,
      uploadedByFirstName: users.firstName,
      uploadedByEmail: users.email,
    })
    .from(billingImports)
    .leftJoin(users, eq(users.id, billingImports.uploadedByUserId))
    .where(eq(billingImports.id, params.id))
    .limit(1);

  if (!row) notFound();

  const diff = row.diffSnapshot as unknown as DiffResult | null;
  const allRows = diff?.rows ?? [];
  const updates = allRows.filter((r) => r.action === "update");
  const noOps = allRows.filter((r) => r.action === "no_op");
  const unmatched = allRows.filter((r) => r.action === "unmatched");
  const inserts = allRows.filter((r) => r.action === "insert");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/billing-import"
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ← Back to billing import
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {row.fileName}
        </h1>
        <p className="text-sm text-slate-600">
          {row.rowsTotal.toLocaleString()} customer rows ·
          uploaded by {row.uploadedByFirstName ?? row.uploadedByEmail ?? "—"} on{" "}
          {new Date(row.uploadedAt as Date).toLocaleString()} ·
          status{" "}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              row.status === "applied"
                ? "bg-emerald-50 text-emerald-700"
                : row.status === "aborted"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {row.status}
          </span>
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Updates" value={updates.length} accent="primary" />
        <SummaryTile label="No-ops" value={noOps.length} />
        <SummaryTile label="Unmatched" value={unmatched.length} accent="warning" />
        <SummaryTile
          label="MRR delta"
          value={`${Number(row.mrrDelta) >= 0 ? "+" : ""}$${Math.round(Number(row.mrrDelta)).toLocaleString()}`}
          accent={Number(row.mrrDelta) >= 0 ? "success" : "warning"}
        />
      </div>

      {/* Apply / Abort */}
      {row.status === "uploaded" || row.status === "previewed" ? (
        <ApplyAbortButtons billingImportId={row.id} />
      ) : (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {row.status === "applied"
            ? `Applied on ${new Date(row.appliedAt as Date).toLocaleString()}.`
            : "This import was aborted; no changes were written."}
        </div>
      )}

      {/* Diff tables */}
      <DiffSection
        title={`Updates (${updates.length})`}
        description="Existing accounts that will get new service_profile values."
        rows={updates}
        showMrrDelta
      />
      <DiffSection
        title={`Unmatched (${unmatched.length})`}
        description="Customer rows in the CSV with no matching account. Skipped on apply — link them manually first if needed."
        rows={unmatched}
        showMrrDelta
        emptyMessage="Every customer row matched an existing account."
      />
      <DiffSection
        title={`No-ops (${noOps.length})`}
        description="Matched accounts whose service_profile would be unchanged. Skipped on apply."
        rows={noOps}
        collapsible
      />
      {inserts.length > 0 ? (
        <DiffSection
          title={`Inserts (${inserts.length})`}
          description="New accounts that would be created. (Inserts are not auto-applied; the bulk W1 script handles initial loads.)"
          rows={inserts}
          showMrrDelta
        />
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "primary" | "success" | "warning";
}) {
  const valueCls =
    accent === "success"
      ? "text-emerald-700"
      : accent === "warning"
        ? "text-rose-700"
        : accent === "primary"
          ? "text-filta-blue"
          : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueCls}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function DiffSection({
  title,
  description,
  rows,
  showMrrDelta,
  emptyMessage,
  collapsible,
}: {
  title: string;
  description: string;
  rows: DiffRow[];
  showMrrDelta?: boolean;
  emptyMessage?: string;
  collapsible?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {emptyMessage ?? "Nothing in this group."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <details
        className="mt-3"
        open={!collapsible}
      >
        <summary className="cursor-pointer text-xs text-filta-blue hover:underline">
          {collapsible ? "Show details" : "Hide details"}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">CSV name</th>
                <th className="px-3 py-2">Matched account</th>
                <th className="px-3 py-2">Service changes</th>
                {showMrrDelta ? (
                  <th className="px-3 py-2 text-right">MRR Δ</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, idx) => {
                const changedServices = computeChangedServices(r);
                return (
                  <tr key={`${r.normalizedKey}-${idx}`} className="align-top">
                    <td className="px-3 py-2 text-slate-900">
                      {r.csvCustomerName}
                    </td>
                    <td className="px-3 py-2">
                      {r.accountId ? (
                        <Link
                          href={`/accounts/${r.accountId}`}
                          className="text-slate-700 hover:underline"
                        >
                          {r.matchedCompanyName}
                        </Link>
                      ) : (
                        <span className="text-amber-700">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {changedServices.length === 0 ? (
                        <span className="text-slate-400">No change</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {changedServices.map((c) => (
                            <li key={c.key} className="text-slate-700">
                              <span className="font-medium">
                                {SERVICE_LABEL[c.key] ?? c.key}
                              </span>
                              {": "}
                              <span className="text-slate-500">
                                {c.beforeMrr === 0 && c.afterMrr > 0
                                  ? `new — $${c.afterMrr.toFixed(2)}/mo`
                                  : `$${c.beforeMrr.toFixed(2)}/mo → $${c.afterMrr.toFixed(2)}/mo`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    {showMrrDelta ? (
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums ${
                          r.mrrDelta > 0
                            ? "text-emerald-700"
                            : r.mrrDelta < 0
                              ? "text-rose-700"
                              : "text-slate-500"
                        }`}
                      >
                        {r.mrrDelta > 0 ? "+" : ""}${r.mrrDelta.toFixed(2)}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function computeChangedServices(
  r: DiffRow,
): Array<{ key: string; beforeMrr: number; afterMrr: number }> {
  const keys = ["ff", "fs", "fb", "fg", "fc", "fd"] as const;
  const result: Array<{ key: string; beforeMrr: number; afterMrr: number }> = [];
  for (const k of keys) {
    const beforeMrr = r.before?.[k]?.monthly_revenue ?? 0;
    const afterMrr = r.after?.[k]?.monthly_revenue ?? 0;
    if (Math.abs(beforeMrr - afterMrr) > 0.005) {
      result.push({ key: k, beforeMrr, afterMrr });
    }
  }
  return result;
}
