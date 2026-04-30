// /at-risk — customers who need attention.
//
// Pulls every customer-status account in scope and runs each through the
// pure rules engine in lib/at-risk.ts. Anything that lights up at least
// one signal lands on the queue, ranked by score and stage age.
//
// The data fetch is one trip: a CTE-style query that aggregates last
// activity, recent dispositions, recent email failures, and the oldest
// open FS opp per account. At ~97 customer rows this comfortably fits
// in memory; once the franchise grows past a few hundred we'd push the
// rule logic into SQL or precompute nightly.
//
// Each row exposes a "Create outreach task" quick-action so the rep can
// turn a flag into a follow-up without opening the account detail page.

import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireSession } from "@/lib/session";
import {
  assessRisk,
  type RiskAssessment,
  type RiskInput,
  TIER_LABEL,
  TIER_PALETTE,
  SEVERITY_PALETTE,
} from "@/lib/at-risk";
import {
  TERRITORY_LABEL,
  formatPhone,
  formatRelative,
} from "@/lib/format";
import CreateOutreachTask from "./CreateOutreachTask";

export const dynamic = "force-dynamic";

type RawAccountRow = {
  id: string;
  company_name: string;
  city: string | null;
  territory: "fun_coast" | "space_coast" | "unassigned";
  phone: string | null;
  account_status: "prospect" | "customer" | "churned" | "do_not_contact";
  nca_flag: boolean;
  service_profile: Record<string, any>;
  owner_first_name: string | null;
  owner_email: string | null;
  // Aggregates from CTEs
  last_activity_at: string | null;
  recent_dispositions: Array<{
    disposition: string | null;
    occurred_at: string;
  }> | null;
  recent_email_failures: Array<{
    event_type: string;
    occurred_at: string;
  }> | null;
  oldest_open_fs_opp_stage: string | null;
  oldest_open_fs_opp_changed_at: string | null;
};

export default async function AtRiskPage({
  searchParams,
}: {
  searchParams?: { tier?: string };
}) {
  const session = await requireSession();
  const tierFilter = (searchParams?.tier ?? "all") as
    | "all"
    | "watch"
    | "at_risk"
    | "critical";

  // Territory clamp drops straight into SQL; session beats URL the same way
  // every other surface does.
  let territoryClause = sql``;
  if (session.territory === "fun_coast") {
    territoryClause = sql`and a.territory = 'fun_coast'`;
  } else if (session.territory === "space_coast") {
    territoryClause = sql`and a.territory = 'space_coast'`;
  }

  // One round-trip query. Each lateral subquery is independent so the
  // planner can decide to use the per-account indexes we already have on
  // activities.account_id, email_events join via email_sends.account_id,
  // and opportunities.account_id.
  const result = await db.execute(sql`
    select
      a.id,
      a.company_name,
      a.city,
      a.territory,
      a.phone,
      a.account_status,
      a.nca_flag,
      a.service_profile,
      u.first_name as owner_first_name,
      u.email as owner_email,
      la.last_activity_at,
      coalesce(rd.recent_dispositions, '[]'::jsonb) as recent_dispositions,
      coalesce(ref.recent_email_failures, '[]'::jsonb) as recent_email_failures,
      oo.oldest_open_fs_opp_stage,
      oo.oldest_open_fs_opp_changed_at
    from accounts a
    left join users u on u.id = a.owner_user_id
    left join lateral (
      select max(occurred_at) as last_activity_at
      from activities
      where account_id = a.id
    ) la on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'disposition', disposition::text,
        'occurred_at', occurred_at
      ) order by occurred_at desc) as recent_dispositions
      from (
        select disposition, occurred_at
        from activities
        where account_id = a.id
          and disposition is not null
        order by occurred_at desc
        limit 5
      ) sub
    ) rd on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'event_type', event_type::text,
        'occurred_at', occurred_at
      ) order by occurred_at desc) as recent_email_failures
      from (
        select ee.event_type, ee.occurred_at
        from email_events ee
        join email_sends es on es.id = ee.email_send_id
        where es.account_id = a.id
          and ee.event_type in ('bounced', 'complained')
        order by ee.occurred_at desc
        limit 5
      ) sub
    ) ref on true
    left join lateral (
      select stage::text as oldest_open_fs_opp_stage,
             stage_changed_at as oldest_open_fs_opp_changed_at
      from opportunities
      where account_id = a.id
        and service_type = 'fs'
        and stage not in ('closed_won', 'closed_lost')
        and deleted_at is null
      order by stage_changed_at asc
      limit 1
    ) oo on true
    where a.deleted_at is null
      and a.account_status in ('customer', 'churned', 'do_not_contact')
      ${territoryClause}
  `);

  const rawRows = (result as unknown as { rows: RawAccountRow[] }).rows;

  // Run the rules engine in JS. Build a small typed view to keep the
  // template clean.
  type Row = {
    raw: RawAccountRow;
    assessment: RiskAssessment;
  };

  const now = new Date();
  const rows: Row[] = rawRows
    .map((r): Row => {
      const input: RiskInput = {
        accountStatus: r.account_status,
        ncaFlag: !!r.nca_flag,
        serviceProfile: r.service_profile ?? {},
        lastActivityAt: r.last_activity_at
          ? new Date(r.last_activity_at)
          : null,
        recentDispositions: (r.recent_dispositions ?? []).map((d) => ({
          disposition: d.disposition ?? null,
          occurredAt: new Date(d.occurred_at),
        })),
        recentEmailFailures: (r.recent_email_failures ?? []).map((e) => ({
          eventType: e.event_type as "bounced" | "complained",
          occurredAt: new Date(e.occurred_at),
        })),
        oldestOpenFsOpp:
          r.oldest_open_fs_opp_stage && r.oldest_open_fs_opp_changed_at
            ? {
                stage: r.oldest_open_fs_opp_stage,
                stageChangedAt: new Date(r.oldest_open_fs_opp_changed_at),
              }
            : null,
        now,
      };
      return { raw: r, assessment: assessRisk(input) };
    })
    .filter((r) => r.assessment.tier !== "ok");

  // Sort: score desc, then by oldest in-stage signal first.
  rows.sort((a, b) => {
    if (b.assessment.score !== a.assessment.score) {
      return b.assessment.score - a.assessment.score;
    }
    const aMaxAge = Math.max(
      0,
      ...a.assessment.signals.map((s) => s.ageDays ?? 0),
    );
    const bMaxAge = Math.max(
      0,
      ...b.assessment.signals.map((s) => s.ageDays ?? 0),
    );
    return bMaxAge - aMaxAge;
  });

  // Tier counts for chip badges (based on UNFILTERED rows).
  const counts = {
    all: rows.length,
    watch: rows.filter((r) => r.assessment.tier === "watch").length,
    at_risk: rows.filter((r) => r.assessment.tier === "at_risk").length,
    critical: rows.filter((r) => r.assessment.tier === "critical").length,
  };

  const visible =
    tierFilter === "all"
      ? rows
      : rows.filter((r) => r.assessment.tier === tierFilter);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          At-risk customers
        </h1>
        <p className="max-w-2xl text-sm text-slate-600">
          Customer accounts with one or more risk signals — overdue service,
          bounced emails, recent complaints, dormant relationships, or stuck
          FiltaClean opportunities. Ranked by score so the most urgent
          surface to the top.
        </p>
      </div>

      {/* Tier chips */}
      <nav className="flex flex-wrap gap-1.5 text-sm">
        <Chip
          href="/at-risk"
          active={tierFilter === "all"}
        >
          All <Count>{counts.all}</Count>
        </Chip>
        <Chip
          href="/at-risk?tier=critical"
          active={tierFilter === "critical"}
          tone="critical"
        >
          Critical <Count tone="white">{counts.critical}</Count>
        </Chip>
        <Chip
          href="/at-risk?tier=at_risk"
          active={tierFilter === "at_risk"}
          tone="at_risk"
        >
          At risk <Count tone="white">{counts.at_risk}</Count>
        </Chip>
        <Chip
          href="/at-risk?tier=watch"
          active={tierFilter === "watch"}
          tone="watch"
        >
          Watch <Count tone="white">{counts.watch}</Count>
        </Chip>
      </nav>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="hidden px-4 py-3 sm:table-cell">Tier</th>
                <th className="px-4 py-3">Reasons</th>
                <th className="hidden px-4 py-3 lg:table-cell">Owner</th>
                <th className="hidden px-4 py-3 md:table-cell">Phone</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    {rows.length === 0
                      ? "No at-risk customers in scope. Nice."
                      : "No customers in this tier."}
                  </td>
                </tr>
              ) : (
                visible.map(({ raw, assessment }) => (
                  <tr key={raw.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3">
                      <Link
                        href={`/accounts/${raw.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {raw.company_name}
                      </Link>
                      {raw.nca_flag ? (
                        <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                          NCA
                        </span>
                      ) : null}
                      <div className="mt-0.5 text-xs text-slate-500">
                        {raw.city ?? "—"} · {TERRITORY_LABEL[raw.territory]}
                      </div>
                      {/* Mobile-only tier + phone */}
                      <div className="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
                        <TierBadge tier={assessment.tier} score={assessment.score} />
                        {raw.phone ? (
                          <a
                            href={`tel:${raw.phone}`}
                            className="text-xs text-slate-600 hover:underline"
                          >
                            {formatPhone(raw.phone)}
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <TierBadge tier={assessment.tier} score={assessment.score} />
                    </td>
                    <td className="px-4 py-3">
                      <ul className="flex flex-wrap gap-1.5">
                        {assessment.signals.map((s) => (
                          <li
                            key={s.code}
                            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_PALETTE[s.severity]}`}
                            title={s.reason}
                          >
                            {s.reason}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">
                      {raw.owner_first_name ?? raw.owner_email ?? "—"}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-700 md:table-cell">
                      {raw.phone ? (
                        <a
                          href={`tel:${raw.phone}`}
                          className="hover:underline"
                        >
                          {formatPhone(raw.phone)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CreateOutreachTask
                        accountId={raw.id}
                        companyName={raw.company_name}
                        topReason={assessment.signals[0]?.reason ?? "Risk flagged"}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Last activity timestamps are pulled from the activity timeline; service
        cadence comes from each account&apos;s service profile. Tune the
        thresholds in <code>src/lib/at-risk.ts</code> as patterns settle.
      </p>
    </div>
  );
}

function TierBadge({
  tier,
  score,
}: {
  tier: RiskAssessment["tier"];
  score: number;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${TIER_PALETTE[tier]}`}
      title={`Risk score ${score}`}
    >
      {TIER_LABEL[tier]}
      <span className="rounded bg-white/60 px-1 text-[10px] font-semibold">
        {score}
      </span>
    </span>
  );
}

function Chip({
  href,
  active,
  tone,
  children,
}: {
  href: string;
  active: boolean;
  tone?: "watch" | "at_risk" | "critical";
  children: React.ReactNode;
}) {
  let activeCls = "bg-filta-blue text-white border-filta-blue";
  if (active && tone === "critical") {
    activeCls = "bg-rose-600 text-white border-rose-600";
  } else if (active && tone === "at_risk") {
    activeCls = "bg-orange-600 text-white border-orange-600";
  } else if (active && tone === "watch") {
    activeCls = "bg-amber-500 text-white border-amber-500";
  }
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
        active
          ? activeCls
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
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
  tone?: "white";
}) {
  return (
    <span
      className={`rounded px-1 text-[11px] font-semibold ${
        tone === "white"
          ? "bg-white/20 text-current"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {children}
    </span>
  );
}
