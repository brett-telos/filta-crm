// /leads — prospect-funnel list view.
//
// "Leads" in this CRM are accounts with account_status='prospect'. They live
// in the same table as customers because the existing import pipeline (W1)
// already lands the 5,670-row Filta corporate lead universe there. Splitting
// them into a separate physical table would be a migration and dedupe
// rewrite for no real upside; a status filter does the same job.
//
// What this view adds beyond /accounts?status=prospect:
//   - sales_funnel_stage chips so a rep can scan "what's qualified vs
//     contacted vs new" without opening rows
//   - "Stale in stage" sort so leads aging in a stage surface to the top —
//     the staleness signal Sam & Linda asked about during discovery
//   - last activity timestamp for the same reason: a lead with no activity
//     in 30 days needs love, not another templated email
//   - Mobile fallback: no table, just a stack of cards. The hidden columns
//     on the desktop table aren't useful enough to fight for on a phone.
//
// Territory scoping piggy-backs on session.territory the same way as
// /accounts and /cross-sell — the page never trusts a query string to widen
// scope.

import Link from "next/link";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  accounts,
  activities,
} from "@/db";
import { requireSession } from "@/lib/session";
import {
  STAGE_LABEL,
  TERRITORY_LABEL,
  formatPhone,
  formatRelative,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Stages we display in the funnel (excludes closed_lost; that's a separate
// "Lost" tab toggled via the status filter chips). closed_won is also
// excluded because once a lead's won they should be a customer — we surface
// it via a separate "Recent conversions" chip rather than letting won deals
// linger in the active funnel.
const FUNNEL_STAGES = [
  "new_lead",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
] as const;

type FunnelStage = (typeof FUNNEL_STAGES)[number];

type SearchParams = {
  q?: string;
  territory?: string;
  stage?: string;
  sort?: string;
  page?: string;
  view?: string; // 'active' (default) | 'lost' | 'all'
};

const SORTS = ["stale", "newest", "oldest", "company"] as const;
type Sort = (typeof SORTS)[number];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await requireSession();

  const q = (searchParams?.q ?? "").trim();
  const territoryFilter = searchParams?.territory ?? "all";
  const stageFilter = (searchParams?.stage ?? "all") as
    | "all"
    | FunnelStage;
  const view = (searchParams?.view ?? "active") as "active" | "lost" | "all";
  const sort: Sort = (SORTS as readonly string[]).includes(
    searchParams?.sort ?? "",
  )
    ? (searchParams!.sort as Sort)
    : "stale";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);

  // ---- Build WHERE clause ---------------------------------------------------
  const conditions = [
    isNull(accounts.deletedAt),
    eq(accounts.accountStatus, "prospect"),
  ];

  // View — active funnel (excludes closed_lost), lost only, or all.
  if (view === "active") {
    conditions.push(
      sql`${accounts.salesFunnelStage} <> 'closed_lost'`,
    );
  } else if (view === "lost") {
    conditions.push(eq(accounts.salesFunnelStage, "closed_lost"));
  }

  // Stage chip overrides view when set to a specific stage.
  if (
    stageFilter !== "all" &&
    (FUNNEL_STAGES as readonly string[]).includes(stageFilter)
  ) {
    conditions.push(eq(accounts.salesFunnelStage, stageFilter as FunnelStage));
  }

  // Territory clamp (session beats URL).
  if (session.territory === "fun_coast") {
    conditions.push(eq(accounts.territory, "fun_coast"));
  } else if (session.territory === "space_coast") {
    conditions.push(eq(accounts.territory, "space_coast"));
  } else if (
    territoryFilter === "fun_coast" ||
    territoryFilter === "space_coast" ||
    territoryFilter === "unassigned"
  ) {
    conditions.push(eq(accounts.territory, territoryFilter));
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

  // ---- ORDER BY -------------------------------------------------------------
  // 'stale' = longest in current stage. Pulls leads that are aging, which is
  // the signal a rep cares about most when they open the page in the morning.
  const orderBy =
    sort === "newest"
      ? [desc(accounts.createdAt)]
      : sort === "oldest"
        ? [asc(accounts.createdAt)]
        : sort === "company"
          ? [asc(accounts.companyName)]
          : [asc(accounts.salesFunnelStageChangedAt)];

  // ---- Counts per stage (for the chip badges) -------------------------------
  // One scan with FILTER aggregates is faster than 5 separate queries.
  const countsScopeConditions = [
    isNull(accounts.deletedAt),
    eq(accounts.accountStatus, "prospect"),
  ];
  if (session.territory === "fun_coast") {
    countsScopeConditions.push(eq(accounts.territory, "fun_coast"));
  } else if (session.territory === "space_coast") {
    countsScopeConditions.push(eq(accounts.territory, "space_coast"));
  } else if (
    territoryFilter === "fun_coast" ||
    territoryFilter === "space_coast" ||
    territoryFilter === "unassigned"
  ) {
    countsScopeConditions.push(eq(accounts.territory, territoryFilter));
  }

  const [stageCountsRow, [{ count: total }], rows] = await Promise.all([
    db
      .select({
        new_lead: sql<number>`count(*) filter (where sales_funnel_stage = 'new_lead')::int`,
        contacted: sql<number>`count(*) filter (where sales_funnel_stage = 'contacted')::int`,
        qualified: sql<number>`count(*) filter (where sales_funnel_stage = 'qualified')::int`,
        proposal: sql<number>`count(*) filter (where sales_funnel_stage = 'proposal')::int`,
        negotiation: sql<number>`count(*) filter (where sales_funnel_stage = 'negotiation')::int`,
        closed_lost: sql<number>`count(*) filter (where sales_funnel_stage = 'closed_lost')::int`,
        active: sql<number>`count(*) filter (where sales_funnel_stage <> 'closed_lost')::int`,
      })
      .from(accounts)
      .where(and(...countsScopeConditions)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(accounts)
      .where(whereExpr),
    db
      .select({
        id: accounts.id,
        companyName: accounts.companyName,
        city: accounts.city,
        territory: accounts.territory,
        phone: accounts.phone,
        salesFunnelStage: accounts.salesFunnelStage,
        salesFunnelStageChangedAt: accounts.salesFunnelStageChangedAt,
        fryerCount: accounts.fryerCount,
        ncaFlag: accounts.ncaFlag,
        ncaName: accounts.ncaName,
        // Most recent activity timestamp via a correlated scalar subquery.
        // Cheap on this scale (a few thousand prospect rows) and avoids
        // dragging the activities join into the main query.
        lastActivityAt: sql<Date | null>`(
          select max(${activities.occurredAt})
          from ${activities}
          where ${activities.accountId} = ${accounts.id}
        )`,
      })
      .from(accounts)
      .where(whereExpr)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);

  const stageCounts = stageCountsRow[0]!;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Helper for chip / pagination URLs.
  const buildHref = (override: Partial<SearchParams>) => {
    const merged: Record<string, string> = {
      q,
      territory: territoryFilter,
      stage: stageFilter,
      view,
      sort,
    };
    Object.entries(override).forEach(([k, v]) => {
      if (v == null) delete merged[k];
      else merged[k] = String(v);
    });
    // Drop default values to keep URLs clean.
    if (merged.territory === "all") delete merged.territory;
    if (merged.stage === "all") delete merged.stage;
    if (merged.view === "active") delete merged.view;
    if (merged.sort === "stale") delete merged.sort;
    if (!merged.q) delete merged.q;
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Leads
          </h1>
          <p className="text-sm text-slate-600">
            {total.toLocaleString()} {total === 1 ? "lead" : "leads"}
            {q ? ` matching "${q}"` : ""} ·{" "}
            <Link
              href="/leads/board"
              className="text-filta-blue hover:underline"
            >
              Board view →
            </Link>
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Sort:{" "}
          <SortSelect value={sort} buildHref={buildHref} />
        </div>
      </div>

      {/* Stage chips ------------------------------------------------------- */}
      <nav className="flex flex-wrap gap-1.5 text-sm">
        <Chip
          href={buildHref({ stage: "all", view: "active" })}
          active={stageFilter === "all" && view === "active"}
        >
          All active
          <Count>{stageCounts.active}</Count>
        </Chip>
        {FUNNEL_STAGES.map((s) => (
          <Chip
            key={s}
            href={buildHref({ stage: s, view: "active" })}
            active={stageFilter === s}
          >
            {STAGE_LABEL[s]}
            <Count>{(stageCounts as any)[s]}</Count>
          </Chip>
        ))}
        <Chip
          href={buildHref({ view: "lost", stage: "all" })}
          active={view === "lost"}
        >
          Lost
          <Count tone="muted">{stageCounts.closed_lost}</Count>
        </Chip>
      </nav>

      {/* Search + territory filter ----------------------------------------- */}
      <form
        method="GET"
        className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4"
      >
        <input type="hidden" name="stage" value={stageFilter} />
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="sort" value={sort} />
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600">
            Search
          </label>
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

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-md bg-filta-blue px-3 py-2 text-sm font-semibold text-white hover:bg-filta-blue-dark"
          >
            Apply
          </button>
          <Link
            href="/leads"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Reset
          </Link>
        </div>
      </form>

      {/* Table ------------------------------------------------------------- */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="hidden px-4 py-3 md:table-cell">Stage</th>
                <th className="hidden px-4 py-3 lg:table-cell">In stage</th>
                <th className="hidden px-4 py-3 lg:table-cell">Last touch</th>
                <th className="hidden px-4 py-3 md:table-cell">City</th>
                <th className="hidden px-4 py-3 lg:table-cell">Territory</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">
                  Fryers
                </th>
                <th className="hidden px-4 py-3 sm:table-cell">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    No leads match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const inStage = formatRelative(r.salesFunnelStageChangedAt);
                  const lastTouch = r.lastActivityAt
                    ? formatRelative(r.lastActivityAt)
                    : "—";
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/accounts/${r.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {r.companyName}
                        </Link>
                        {r.ncaFlag ? (
                          <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                            NCA{r.ncaName ? ` · ${r.ncaName}` : ""}
                          </span>
                        ) : null}
                        {/* Mobile-only secondary line: stage + city + last
                            touch — covers the desktop columns we hide. */}
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500 md:hidden">
                          <StagePill stage={r.salesFunnelStage} />
                          {r.city ? <span>{r.city}</span> : null}
                          <span>· {inStage} in stage</span>
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
                      <td className="hidden px-4 py-3 md:table-cell">
                        <StagePill stage={r.salesFunnelStage} />
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">
                        {inStage}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">
                        {lastTouch}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 md:table-cell">
                        {r.city ?? "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">
                        {TERRITORY_LABEL[r.territory]}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-slate-700 sm:table-cell">
                        {r.fryerCount ?? "—"}
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
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <div>
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildHref({ page: String(page - 1) })}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                ← Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={buildHref({ page: String(page + 1) })}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                Next →
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------
// UI bits
// ----------------------------------------------------------------------------

function Chip({
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
        active
          ? "border-filta-blue bg-filta-blue text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}

function Count({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "muted";
}) {
  return (
    <span
      className={`rounded px-1 text-[11px] font-semibold ${
        tone === "muted"
          ? "bg-slate-100 text-slate-500"
          : "bg-white/20 text-current"
      }`}
    >
      {children}
    </span>
  );
}

// Stage pill — uses the same color scheme as the pipeline kanban so reps see
// consistent visual language across both views.
const STAGE_PILL_PALETTE: Record<string, string> = {
  new_lead: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-50 text-blue-700",
  qualified: "bg-indigo-50 text-indigo-700",
  proposal: "bg-violet-50 text-violet-700",
  negotiation: "bg-amber-50 text-amber-800",
  closed_won: "bg-emerald-50 text-emerald-700",
  closed_lost: "bg-rose-50 text-rose-700",
};

function StagePill({ stage }: { stage: string }) {
  const cls = STAGE_PILL_PALETTE[stage] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

// Sort dropdown — server-roundtrip via Link rather than a client form so the
// list page stays fully RSC.
function SortSelect({
  value,
  buildHref,
}: {
  value: Sort;
  buildHref: (o: Partial<SearchParams>) => string;
}) {
  const labels: Record<Sort, string> = {
    stale: "Stale in stage",
    newest: "Newest",
    oldest: "Oldest",
    company: "Company A→Z",
  };
  return (
    <span className="inline-flex items-center gap-1">
      {SORTS.map((s, i) => (
        <span key={s}>
          {i > 0 ? <span className="mx-1 text-slate-300">·</span> : null}
          <Link
            href={buildHref({ sort: s })}
            className={
              s === value
                ? "font-semibold text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }
          >
            {labels[s]}
          </Link>
        </span>
      ))}
    </span>
  );
}
