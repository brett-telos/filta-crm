// Accounts list. Filters by territory + status + full-text search (ILIKE
// on company_name / city). Paginated server-side. Territory filter is
// constrained by the session's own territory — a Fun Coast rep can't see
// Space Coast accounts even if they hand-craft a query string.

import Link from "next/link";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, accounts } from "@/db";
import { requireSession } from "@/lib/session";
import {
  ACCOUNT_STATUS_LABEL,
  TERRITORY_LABEL,
  formatPhone,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = {
  q?: string;
  territory?: string;
  status?: string;
  page?: string;
  sort?: string;
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await requireSession();

  const q = (searchParams?.q ?? "").trim();
  const territoryFilter = searchParams?.territory ?? "all";
  const statusFilter = searchParams?.status ?? "all";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const sort = searchParams?.sort ?? "company";

  // Base filters
  const conditions = [isNull(accounts.deletedAt)];

  // Territory scoping — both the session and the filter clamp this down.
  if (session.territory === "fun_coast") {
    conditions.push(eq(accounts.territory, "fun_coast"));
  } else if (session.territory === "space_coast") {
    conditions.push(eq(accounts.territory, "space_coast"));
  } else {
    if (territoryFilter === "fun_coast" || territoryFilter === "space_coast") {
      conditions.push(eq(accounts.territory, territoryFilter));
    } else if (territoryFilter === "unassigned") {
      conditions.push(eq(accounts.territory, "unassigned"));
    }
  }

  if (
    statusFilter === "prospect" ||
    statusFilter === "customer" ||
    statusFilter === "churned" ||
    statusFilter === "do_not_contact"
  ) {
    conditions.push(eq(accounts.accountStatus, statusFilter));
  }

  if (q) {
    const wildcard = `%${q}%`;
    conditions.push(
      or(
        ilike(accounts.companyName, wildcard),
        ilike(accounts.city, wildcard),
        ilike(accounts.dbaName, wildcard),
      )!,
    );
  }

  const whereExpr = and(...conditions);

  const orderBy =
    sort === "created"
      ? [desc(accounts.createdAt)]
      : sort === "updated"
        ? [desc(accounts.updatedAt)]
        : [asc(accounts.companyName)];

  const [rows, [{ count: total }]] = await Promise.all([
    db
      .select({
        id: accounts.id,
        companyName: accounts.companyName,
        city: accounts.city,
        territory: accounts.territory,
        accountStatus: accounts.accountStatus,
        phone: accounts.phone,
        fryerCount: accounts.fryerCount,
        serviceProfile: accounts.serviceProfile,
      })
      .from(accounts)
      .where(whereExpr)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(accounts)
      .where(whereExpr),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Accounts
          </h1>
          <p className="text-sm text-slate-600">
            {total.toLocaleString()} {total === 1 ? "account" : "accounts"}
            {q ? ` matching "${q}"` : ""}
          </p>
        </div>
      </div>

      <form
        method="GET"
        className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4"
      >
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600">Search</label>
          <input
            name="q"
            defaultValue={q}
            placeholder="Company, DBA, or city"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        {session.territory === "both" ? (
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Territory
            </label>
            <select
              name="territory"
              defaultValue={territoryFilter}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <option value="all">All</option>
              <option value="fun_coast">Fun Coast</option>
              <option value="space_coast">Space Coast</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        ) : (
          <input type="hidden" name="territory" value={session.territory} />
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600">Status</label>
          <select
            name="status"
            defaultValue={statusFilter}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="all">All</option>
            <option value="prospect">Prospect</option>
            <option value="customer">Customer</option>
            <option value="churned">Churned</option>
            <option value="do_not_contact">Do Not Contact</option>
          </select>
        </div>

        <div className="sm:col-span-4 flex flex-wrap items-center gap-2">
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="company">Sort: Company A→Z</option>
            <option value="updated">Sort: Recently updated</option>
            <option value="created">Sort: Recently created</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-filta-blue px-3 py-2 text-sm font-semibold text-white hover:bg-filta-blue-dark"
          >
            Apply
          </button>
          <Link
            href="/accounts"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Reset
          </Link>
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="hidden px-4 py-3 md:table-cell">City</th>
                <th className="hidden px-4 py-3 lg:table-cell">Territory</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell">Phone</th>
                <th className="hidden px-4 py-3 text-right lg:table-cell">Fryers</th>
                <th className="hidden px-4 py-3 md:table-cell">Services</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No accounts match those filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const sp = (r.serviceProfile as Record<string, any>) || {};
                  const active = ["ff", "fs", "fb", "fg", "fc", "fd"].filter(
                    (k) => sp?.[k]?.active === true,
                  );
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/accounts/${r.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {r.companyName}
                        </Link>
                        {/* Mobile-only secondary line: city + phone so the
                            hidden columns still surface on a phone. */}
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500 sm:hidden">
                          {r.city ? <span>{r.city}</span> : null}
                          {r.phone ? (
                            <a
                              href={`tel:${r.phone}`}
                              className="text-slate-600 hover:underline"
                            >
                              {formatPhone(r.phone)}
                            </a>
                          ) : null}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 md:table-cell">
                        {r.city ?? "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">
                        {TERRITORY_LABEL[r.territory]}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.accountStatus} />
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 sm:table-cell">
                        {r.phone ? (
                          <a
                            href={`tel:${r.phone}`}
                            className="hover:underline"
                          >
                            {formatPhone(r.phone)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-slate-700 lg:table-cell">
                        {r.fryerCount ?? "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 md:table-cell">
                        {active.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {active.map((k) => (
                              <span
                                key={k}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium uppercase text-slate-700"
                              >
                                {k}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        searchParams={{ q, territory: territoryFilter, status: statusFilter, sort }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, string> = {
    prospect: "bg-blue-50 text-blue-700 border-blue-200",
    customer: "bg-emerald-50 text-emerald-700 border-emerald-200",
    churned: "bg-amber-50 text-amber-700 border-amber-200",
    do_not_contact: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const cls = palette[status] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {ACCOUNT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Pagination({
  page,
  totalPages,
  searchParams,
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string>;
}) {
  if (totalPages <= 1) return null;
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    params.set("page", String(p));
    return `/accounts?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <div>
        Page {page} of {totalPages}
      </div>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            ← Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            Next →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
