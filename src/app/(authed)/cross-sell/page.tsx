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
  formatRelative,
} from "@/lib/format";
import CreateFsButton from "./CreateFsButton";
import SendEmailButton from "./SendEmailButton";

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
  // Primary-contact email (or any contact email as fallback). Powers the
  // "Send FS email" button — disabled when null/empty.
  contact_email: string | null;
  // Existing open FS opportunity for this account, if any. After the
  // cross-sell backfill (Apr 2026) every customer has a `new_lead` FS opp,
  // so we no longer exclude these from the queue — instead we surface the
  // opp id/stage so the row swaps "Create FS opp" for "Open FS opp →".
  fs_opp_id: string | null;
  fs_opp_stage: string | null;
  // Engagement summary from the most recent FS cross-sell email_sends row
  // for this account. Null when no FS email has been sent yet. Populated
  // via a lateral join below so we don't fan out per-row.
  last_send_at: string | null;
  last_send_status:
    | "queued"
    | "sent"
    | "delivered"
    | "bounced"
    | "complained"
    | "failed"
    | null;
  last_send_open_count: number | null;
  last_send_replied_at: string | null;
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

  // Pull one contact email per account: primary if present, else the most
  // recently updated contact with a non-empty email. `distinct on` lets us
  // pick the "best" contact per account in a single pass and feed it into
  // the main query as a lateral join — cheaper than a correlated subquery on
  // 90-odd rows and keeps the plan explainable.
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
      u.email as owner_email,
      c.email as contact_email,
      o.id as fs_opp_id,
      o.stage as fs_opp_stage,
      es.created_at as last_send_at,
      es.status as last_send_status,
      es.open_count as last_send_open_count,
      es.replied_at as last_send_replied_at
    from accounts a
    left join users u on u.id = a.owner_user_id
    left join lateral (
      select email
      from contacts
      where account_id = a.id
        and deleted_at is null
        and email is not null
        and length(trim(email)) > 0
      order by is_primary desc, updated_at desc
      limit 1
    ) c on true
    -- The current open FS opportunity for this account, if one exists.
    -- After the Apr 2026 backfill every customer has a new_lead FS opp,
    -- so we surface its id+stage instead of excluding the row. The row
    -- swaps "Create FS opp" for "Open FS opp" when this is non-null.
    left join lateral (
      select o_inner.id, o_inner.stage
      from opportunities o_inner
      where o_inner.account_id = a.id
        and o_inner.service_type = 'fs'
        and o_inner.stage not in ('closed_won','closed_lost')
        and o_inner.deleted_at is null
      order by o_inner.created_at desc
      limit 1
    ) o on true
    -- Most recent FS cross-sell email per account. Lateral join keeps the
    -- per-row cost bounded — we only ever look at the latest send for the
    -- engagement chip; older sends are visible on the account detail card.
    --
    -- Filter to fs_cross_sell purpose so a non-FS email (e.g. a future
    -- general followup template) doesn't hijack the chip. If no FS template
    -- has been sent yet, all four columns come back NULL and the chip
    -- renders "Not sent".
    left join lateral (
      select es_inner.created_at, es_inner.status, es_inner.open_count,
             es_inner.replied_at
      from email_sends es_inner
      join message_templates mt on mt.id = es_inner.template_id
      where es_inner.account_id = a.id
        and mt.purpose = 'fs_cross_sell'
      order by es_inner.created_at desc
      limit 1
    ) es on true
    where a.account_status = 'customer'
      and (a.service_profile->'ff'->>'active')::boolean = true
      and coalesce((a.service_profile->'fs'->>'active')::boolean, false) = false
      and a.deleted_at is null
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
                <th className="hidden px-4 py-3 sm:table-cell">Engagement</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
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
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <EngagementChip
                          lastSendAt={r.last_send_at}
                          status={r.last_send_status}
                          openCount={r.last_send_open_count ?? 0}
                          repliedAt={r.last_send_replied_at}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          {r.fs_opp_id ? (
                            <Link
                              href={`/opportunities/${r.fs_opp_id}/quote`}
                              className="inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-md bg-service-fs px-3 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95"
                            >
                              Open FS opp →
                            </Link>
                          ) : (
                            <CreateFsButton accountId={r.id} />
                          )}
                          <SendEmailButton
                            accountId={r.id}
                            companyName={r.company_name}
                            contactEmail={r.contact_email}
                          />
                        </div>
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

// Engagement chip — at-a-glance signal of how the most recent email did.
// Priority: replied > opened > sent-but-cold > delivery problem > never sent.
// "Cold" appears once a sent email has gone 3+ days without engagement; the
// rep should consider a phone follow-up before another email.
function EngagementChip({
  lastSendAt,
  status,
  openCount,
  repliedAt,
}: {
  lastSendAt: string | null;
  status:
    | "queued"
    | "sent"
    | "delivered"
    | "bounced"
    | "complained"
    | "failed"
    | null;
  openCount: number;
  repliedAt: string | null;
}) {
  if (!lastSendAt || !status) {
    return <span className="text-xs text-slate-400">Not sent</span>;
  }
  const sentAt = new Date(lastSendAt);
  const daysSince = Math.floor(
    (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (repliedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[11px] font-medium uppercase text-emerald-800">
        Replied · {formatRelative(new Date(repliedAt))}
      </span>
    );
  }
  if (status === "bounced" || status === "complained") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium uppercase text-rose-700">
        {status}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium uppercase text-rose-700">
        Failed
      </span>
    );
  }
  if (openCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium uppercase text-emerald-700">
        Opened {openCount}× · {daysSince}d
      </span>
    );
  }
  if (daysSince >= 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">
        Cold · {daysSince}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium uppercase text-blue-700">
      Sent · {daysSince === 0 ? "today" : `${daysSince}d`}
    </span>
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
