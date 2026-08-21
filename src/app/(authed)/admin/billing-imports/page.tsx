// /admin/billing-imports — historical view of every billing CSV upload.
//
// Read-only. Lists every row in billing_imports — applied, aborted, or
// pending — with summary counters and a drill-into link to the same diff
// preview page used for review. Helps Sam, Linda, and Brett see "what
// got into the system this month" at a glance.

import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, billingImports, users } from "@/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BillingImportsHistoryPage() {
  const session = await requireSession();
  if (session.role !== "admin") notFound();

  const rows = await db
    .select({
      id: billingImports.id,
      fileName: billingImports.fileName,
      uploadedAt: billingImports.uploadedAt,
      appliedAt: billingImports.appliedAt,
      status: billingImports.status,
      rowsTotal: billingImports.rowsTotal,
      accountsUpdated: billingImports.accountsUpdated,
      accountsSkipped: billingImports.accountsSkipped,
      mrrDelta: billingImports.mrrDelta,
      uploadedByFirstName: users.firstName,
      uploadedByEmail: users.email,
    })
    .from(billingImports)
    .leftJoin(users, eq(users.id, billingImports.uploadedByUserId))
    .orderBy(desc(billingImports.uploadedAt))
    .limit(100);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Billing import history
        </h1>
        <p className="text-sm text-slate-600">
          Every billing CSV upload, newest first.{" "}
          <Link
            href="/admin/billing-import"
            className="text-filta-blue hover:underline"
          >
            Upload a new one →
          </Link>
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">Applied</th>
                <th className="px-4 py-3 text-right">Updates</th>
                <th className="px-4 py-3 text-right">Skipped</th>
                <th className="px-4 py-3 text-right">MRR Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    No imports yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const mrrDelta = Number(r.mrrDelta);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/billing-import/${r.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {r.fileName}
                        </Link>
                        <div className="text-xs text-slate-500">
                          by{" "}
                          {r.uploadedByFirstName ?? r.uploadedByEmail ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {new Date(r.uploadedAt as Date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {r.appliedAt
                          ? new Date(r.appliedAt as Date).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {r.accountsUpdated.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {r.accountsSkipped.toLocaleString()}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          mrrDelta > 0
                            ? "text-emerald-700"
                            : mrrDelta < 0
                              ? "text-rose-700"
                              : "text-slate-500"
                        }`}
                      >
                        {mrrDelta > 0 ? "+" : ""}${Math.round(mrrDelta).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    uploaded: "bg-amber-50 text-amber-700 border-amber-200",
    previewed: "bg-amber-50 text-amber-700 border-amber-200",
    applied: "bg-emerald-50 text-emerald-700 border-emerald-200",
    aborted: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const cls = palette[status] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}
