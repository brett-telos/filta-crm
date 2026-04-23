// FiltaClean Cross-Sell Dashboard. This is the strategic priority out of the
// Feb 2026 discovery: only 5 of 97 customers have FS despite it being ~70%
// gross margin. Target list = FF-active customers without FS who don't
// already have an open FS opp, ranked by FF monthly revenue (proxy for
// customer size).
//
// One-click "Create FS opportunity" kicks a new opp into the pipeline with
// an auto-computed estimated value. Sortable table; territory-scoped.

import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireSession } from "@/lib/session";
import {
  TERRITORY_LABEL,
  formatCurrency,
  formatPhone,
} from "@/lib/format";
import CreateFsButton from "./CreateFsButton";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  company_name: string;
  city: string | null;
  territory: "fun_coast" | "space_coast" | "unassigned";
  phone: string | null;
  ff_monthly: string | null;
  fb_monthly: string | null;
  owner_first_name: string | null;
  owner_email: string | null;
};

type Sort = "rev_desc" | "rev_asc" | "company" | "territory";

const FS_ESTIMATE_MULT = 4;

export default async function CrossSellPage({
  searchParams,
}: {
  searchParams?: { sort?: string; territory?: string };
}) {
  const session = await requireSession();

  const sort: Sort = (["rev_desc", "rev_asc", "company", "territory"] as const).includes(
    searchParams?.sort as Sort,
  )
    ? (searchParams?.sort as Sort)
    : "rev_desc";

  // Territory scoping — clamp to session's territory when not admin.
  const territoryFilter = searchParams?.territory ?? "all";
  let territoryClause = sql``;
  if (session.territory === "fun_coast") {
    territoryClause = sql`and a.territory = 'fun_coast'`;
  } else if (session.territory === "space_coast") {
    territoryClause = sql`and a.territory = 'space_coast'`;
  } else if (territoryFilter === "fun_coast") {
    territoryClause = sql`and a.territory = 'fun_coast'`;
  } else if (territoryFilter === "space_coast") {
    territoryClause = sql`and a.territory = 'space_coast'`;
  }

  const orderClause =
    sort === "rev_asc"
      ? sql`order by ff_monthly asc nulls last, a.company_name asc`
      : sort === "company"
        ? sql`order by a.company_name asc`
        : sort === "territory"
          ? sql`order by a.territory asc, ff_monthly desc nulls last`
          : sql`order by ff_monthly desc nulls last, a.company_name asc`;

  const result = await db.execute(sql`
    select
      a.id,
      a.company_name,
      a.city,
      a.territory,
      a.phone,
      (a.service_profile->'ff'->>'monthly_revenue')::numeric as ff_monthly,
      (a.service_profile->'fb'->>'monthly_revenue')::numeric as fb_monthly,
      u.first_name as owner_first_name,
      u.email as owner_email
    from accounts a
    left join users u on u.id = a.owner_user_id
    where a.account_status = 'customer'
      and (a.service_profile->'ff'->>'active')::boolean = true
      and coalesce((a.service_profile->'fs'->>'active')::boolean, false) = false
      and a.deleted_at is null
      and not exists (
        select 1 from opportunities o
        where o.account_id = a.id
          and o.service_type = 'fs'
          and o.stage not in ('closed_won','closed_lost')
          and o.deleted_at is null
      )
      ${territoryClause}
    ${orderClause}
  `);

  const rows = (result as any).rows as Row[];

  const totalFfMonthly = rows.reduce(
    (sum, r) => sum + Number(r.ff_monthly ?? 0),
    0,
  );
  const totalFsEstimate = totalFfMonthly * FS_ESTIMATE_MULT;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          FiltaClean Cross-Sell
        </h1>
        <p className="max-w-2xl text-sm text-slate-600">
          FiltaFry customers who don't yet have FiltaClean. FS carries ~70%
          gross margin and only 5 of your 97 customers have it today. One
          click creates an FS opportunity and drops it into the pipeline.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Targets" value={rows.length.toLocaleString()} />
        <Stat
          label="Current FF MRR (from these)"
          value={formatCurrency(totalFfMonthly)}
        />
        <Stat
          label="Est. FS annual potential"
          value={formatCurrency(totalFsEstimate)}
          accent="fs"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
          <SortTab href={buildHref(searchParams, { sort: "rev_desc" })} active={sort === "rev_desc"}>
            Highest FF revenue
          </SortTab>
          <SortTab href={buildHref(searchParams, { sort: "rev_asc" })} active={sort === "rev_asc"}>
            Lowest FF revenue
          </SortTab>
          <SortTab href={buildHref(searchParams, { sort: "company" })} active={sort === "company"}>
            Company A→Z
          </SortTab>
          <SortTab href={buildHref(searchParams, { sort: "territory" })} active={sort === "territory"}>
            By territory
          </SortTab>
        </nav>

        {session.territory === "both" ? (
          <nav className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
            <SortTab href={buildHref(searchParams, { territory: "all" })} active={territoryFilter === "all"}>
              All
            </SortTab>
            <SortTab href={buildHref(searchParams, { territory: "fun_coast" })} active={territoryFilter === "fun_coast"}>
              Fun Coast
            </SortTab>
            <SortTab href={buildHref(searchParams, { territory: "space_coast" })} active={territoryFilter === "space_coast"}>
              Space Coast
            </SortTab>
          </nav>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="hidden px-4 py-3 md:table-cell">City</th>
                <th className="hidden px-4 py-3 lg:table-cell">Territory</th>
                <th className="px-4 py-3 text-right">FF $/mo</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">
                  Est. FS $/yr
                </th>
                <th className="hidden px-4 py-3 lg:table-cell">Owner</th>
                <th className="hidden px-4 py-3 md:table-cell">Phone</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    No open cross-sell targets in scope.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const ff = Number(r.ff_monthly ?? 0);
                  const estFs = ff * FS_ESTIMATE_MULT;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/accounts/${r.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {r.company_name}
                        </Link>
                        {/* Mobile-only secondary line: city + est FS + phone */}
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500 sm:hidden">
                          {r.city ? <span>{r.city}</span> : null}
                          <span className="text-service-fs">
                            est {formatCurrency(estFs)}/yr
                          </span>
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
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(ff)}
                      </td>
                      <td className="hidden px-4 py-3 text-right font-medium text-service-fs sm:table-cell">
                        {formatCurrency(estFs)}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">
                        {r.owner_first_name ?? r.owner_email ?? "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 md:table-cell">
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
                      <td className="px-4 py-3 text-right">
                        <CreateFsButton accountId={r.id} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Estimate model: FS annual ≈ FF monthly × {FS_ESTIMATE_MULT}. Tune after
        the first wins; overrideable on each opportunity.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "fs";
}) {
  // FS accent = FiltaClean brand teal. Reserved for FS-specific dollar
  // moments (e.g. estimated annual potential) so the service color actually
  // signals "FiltaClean" rather than generic "positive money".
  const valueCls = accent === "fs" ? "text-service-fs" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueCls}`}>{value}</div>
    </div>
  );
}

function SortTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1 ${
        active ? "bg-filta-blue text-white" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </Link>
  );
}

function buildHref(
  current: Record<string, string | undefined> | undefined,
  override: Record<string, string>,
): string {
  const params = new URLSearchParams();
  const merged = { ...(current ?? {}), ...override };
  Object.entries(merged).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return qs ? `/cross-sell?${qs}` : "/cross-sell";
}
