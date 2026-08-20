// /admin/billing-import — admin-only landing for the monthly billing CSV
// upload + diff-preview workflow.
//
// Two responsibilities:
//   1. Render the upload form (a client component below)
//   2. List any uploads that are 'uploaded' or 'previewed' but not yet
//      applied, so an admin can resume reviewing one without re-uploading
//
// Apply happens on a per-import detail page (/admin/billing-import/[id])
// where the full diff renders.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db, billingImports, users } from "@/db";
import { requireSession } from "@/lib/session";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function BillingImportLandingPage() {
  const session = await requireSession();
  if (session.role !== "admin") {
    // Sales reps and technicians don't get to see this page at all.
    notFound();
  }

  const pendingRows = await db
    .select({
      id: billingImports.id,
      fileName: billingImports.fileName,
      uploadedAt: billingImports.uploadedAt,
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
    .where(inArray(billingImports.status, ["uploaded", "previewed"]))
    .orderBy(desc(billingImports.uploadedAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Billing CSV import
        </h1>
        <p className="max-w-2xl text-sm text-slate-600">
          Upload the monthly FiltaSymphony billing summary CSV. We&apos;ll
          parse it, match each customer block to an existing account, and
          show a diff preview of what would change in{" "}
          <code>service_profile</code> and <code>last_service_date</code>{" "}
          before anything is written. Re-uploading the same file is a no-op.
          {" "}
          <Link
            href="/admin/billing-imports"
            className="text-filta-blue hover:underline"
          >
            View import history →
          </Link>
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Upload
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick the monthly billing CSV. After upload you&apos;ll be redirected
          to the diff preview where you can apply or abort.
        </p>
        <div className="mt-4">
          <UploadForm />
        </div>
      </section>

      {pendingRows.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pending review ({pendingRows.length})
          </h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {pendingRows.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/billing-import/${r.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {r.fileName}
                  </Link>
                  <div className="text-xs text-slate-500">
                    Uploaded by{" "}
                    {r.uploadedByFirstName ?? r.uploadedByEmail ?? "—"} ·{" "}
                    {new Date(r.uploadedAt as Date).toLocaleString()}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-slate-700">
                    {r.rowsTotal} rows · {r.accountsUpdated} updates · {r.accountsSkipped} skipped
                  </div>
                  <div
                    className={`mt-0.5 ${
                      Number(r.mrrDelta) >= 0
                        ? "text-emerald-700"
                        : "text-rose-700"
                    }`}
                  >
                    {Number(r.mrrDelta) >= 0 ? "+" : ""}
                    ${Math.round(Number(r.mrrDelta)).toLocaleString()}/mo Δ
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
