// /dashboard — owner view.
//
// The page Sam, Linda, and Brett would actually open weekly. Five sections,
// stacked top-down by "is the franchise healthy" priority:
//
//   1. KPI strip — total customers, MRR, FS attach rate, cross-sell targets,
//      at-risk count, opportunities. The 30-second answer.
//   2. MRR by service — quick visual of revenue mix. The 5-of-97 FS attach
//      rate is most actionable signal here; FB and FF dominate today.
//   3. Customer concentration — top 10 by MRR, % of total. Ocean Breeze
//      called out explicitly because the discovery flagged 11.7%
//      concentration risk on a single customer.
//   4. FS cross-sell funnel — targeted → emailed → opened → replied → open
//      opp → closed_won. Live numbers from email_sends + opportunities.
//   5. Action cards — Today, Cross-Sell, At-Risk, Pipeline shortcuts.
//
// Territory scoping piggybacks on session.territory the same way every
// other surface does. A "both" user (admin) sees everything; a Fun Coast
// rep sees Fun Coast numbers only.

import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireSession } from "@/lib/session";
import { getTaskCountsForUser } from "../tasks/actions";
import SendDigestButton from "./SendDigestButton";

export const dynamic = "force-dynamic";

// Service abbreviations rendered as "FiltaXxx" so the dashboard reads
// like the brand instead of like a database column.
const SERVICE_LABEL: Record<string, string> = {
  ff: "FiltaFry",
  fs: "FiltaClean",
  fb: "FiltaBio",
  fg: "FiltaGold",
  fc: "FiltaCool",
  fd: "FiltaDrain",
};

const SERVICE_TINT: Record<string, string> = {
  ff: "bg-blue-500",
  fs: "bg-teal-500",
  fb: "bg-emerald-500",
  fg: "bg-amber-500",
  fc: "bg-sky-400",
  fd: "bg-violet-500",
};

export default async function DashboardPage() {
  const session = await requireSession();
  const taskCounts = await getTaskCountsForUser();

  // ---- Territory clamp -----------------------------------------------------
  // Used as a SQL fragment in every query below. Session beats URL — there's
  // no URL-driven territory toggle on the dashboard; an admin sees the whole
  // book, a rep sees their territory.
  let territoryClause = sql``;
  if (session.territory === "fun_coast") {
    territoryClause = sql`and a.territory = 'fun_coast'`;
  } else if (session.territory === "space_coast") {
    territoryClause = sql`and a.territory = 'space_coast'`;
  }

  // ---- KPI strip -----------------------------------------------------------
  // One round-trip. Filter aggregates lift the per-status / per-service
  // counts into a single scan over accounts.
  const [kpiRow] = (
    await db.execute(sql`
      select
        count(*) filter (where a.deleted_at is null)::int as accounts,
        count(*) filter (where a.account_status = 'customer' and a.deleted_at is null)::int as customers,
        count(*) filter (
          where a.account_status = 'customer'
            and a.deleted_at is null
            and (a.service_profile->'fs'->>'active')::boolean = true
        )::int as fs_customers,
        count(*) filter (
          where a.account_status = 'customer'
            and a.deleted_at is null
            and (a.service_profile->'ff'->>'active')::boolean = true
        )::int as ff_customers,
        coalesce(sum(
          case when a.account_status = 'customer' and a.deleted_at is null then
            coalesce((a.service_profile->'ff'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fs'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fb'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fg'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fc'->>'monthly_revenue')::numeric, 0) +
            coalesce((a.service_profile->'fd'->>'monthly_revenue')::numeric, 0)
          else 0 end
        ), 0)::numeric as total_mrr
      from accounts a
      where 1 = 1
        ${territoryClause}
    `)
  ).rows as Array<{
    accounts: number;
    customers: number;
    fs_customers: number;
    ff_customers: number;
    total_mrr: string;
  }>;

  const totalCustomers = kpiRow?.customers ?? 0;
  const ffCustomers = kpiRow?.ff_customers ?? 0;
  const fsCustomers = kpiRow?.fs_customers ?? 0;
  const totalMrr = Number(kpiRow?.total_mrr ?? 0);
  const fsAttachRate =
    ffCustomers > 0 ? (fsCustomers / ffCustomers) * 100 : 0;

  // ---- Cross-sell target count (same query as the cross-sell page) --------
  const [crossSellRow] = (
    await db.execute(sql`
      select count(*)::int as count
      from accounts a
      where a.account_status = 'customer'
        and a.deleted_at is null
        and (a.service_profile->'ff'->>'active')::boolean = true
        and coalesce((a.service_profile->'fs'->>'active')::boolean, false) = false
        and not exists (
          select 1 from opportunities o
          where o.account_id = a.id
            and o.service_type = 'fs'
            and o.stage not in ('closed_won','closed_lost')
            and o.deleted_at is null
        )
        ${territoryClause}
    `)
  ).rows as Array<{ count: number }>;
  const crossSellTargets = crossSellRow?.count ?? 0;

  // ---- Open opportunities count -------------------------------------------
  const [oppRow] = (
    await db.execute(sql`
      select count(*)::int as count
      from opportunities o
      join accounts a on a.id = o.account_id
      where o.deleted_at is null
        and o.stage not in ('closed_won','closed_lost')
        ${territoryClause}
    `)
  ).rows as Array<{ count: number }>;
  const openOpps = oppRow?.count ?? 0;

  // ---- MRR by service ------------------------------------------------------
  const [mrrByServiceRow] = (
    await db.execute(sql`
      select
        sum(coalesce((a.service_profile->'ff'->>'monthly_revenue')::numeric, 0))::numeric as ff,
        sum(coalesce((a.service_profile->'fs'->>'monthly_revenue')::numeric, 0))::numeric as fs,
        sum(coalesce((a.service_profile->'fb'->>'monthly_revenue')::numeric, 0))::numeric as fb,
        sum(coalesce((a.service_profile->'fg'->>'monthly_revenue')::numeric, 0))::numeric as fg,
        sum(coalesce((a.service_profile->'fc'->>'monthly_revenue')::numeric, 0))::numeric as fc,
        sum(coalesce((a.service_profile->'fd'->>'monthly_revenue')::numeric, 0))::numeric as fd
      from accounts a
      where a.account_status = 'customer'
        and a.deleted_at is null
        ${territoryClause}
    `)
  ).rows as Array<Record<"ff" | "fs" | "fb" | "fg" | "fc" | "fd", string>>;

  const mrrByService = mrrByServiceRow
    ? {
        ff: Number(mrrByServiceRow.ff ?? 0),
        fs: Number(mrrByServiceRow.fs ?? 0),
        fb: Number(mrrByServiceRow.fb ?? 0),
        fg: Number(mrrByServiceRow.fg ?? 0),
        fc: Number(mrrByServiceRow.fc ?? 0),
        fd: Number(mrrByServiceRow.fd ?? 0),
      }
    : { ff: 0, fs: 0, fb: 0, fg: 0, fc: 0, fd: 0 };
  const mrrTotal = Object.values(mrrByService).reduce((a, b) => a + b, 0);

  // ---- Top 10 customers by MRR --------------------------------------------
  const concentrationRows = (
    await db.execute(sql`
      select
        a.id,
        a.company_name,
        a.territory,
        (
          coalesce((a.service_profile->'ff'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fs'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fb'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fg'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fc'->>'monthly_revenue')::numeric, 0) +
          coalesce((a.service_profile->'fd'->>'monthly_revenue')::numeric, 0)
        )::numeric as mrr
      from accounts a
      where a.account_status = 'customer'
        and a.deleted_at is null
        ${territoryClause}
      order by mrr desc nulls last
      limit 10
    `)
  ).rows as Array<{
    id: string;
    company_name: string;
    territory: string;
    mrr: string;
  }>;

  const topCustomers = concentrationRows.map((r) => ({
    id: r.id,
    name: r.company_name,
    territory: r.territory,
    mrr: Number(r.mrr ?? 0),
    pctOfTotal: totalMrr > 0 ? (Number(r.mrr ?? 0) / totalMrr) * 100 : 0,
  }));

  // ---- FS cross-sell funnel ------------------------------------------------
  // Six stages, each computed against accounts in scope:
  //   targeted   — open cross-sell targets right now (already computed)
  //   emailed    — accounts that received at least one FS-purpose send
  //   opened     — accounts where at least one FS send was opened
  //   replied    — accounts where at least one FS send received a reply
  //   open_opp   — accounts with an OPEN FS opportunity right now
  //   won        — accounts with a closed_won FS opp (lifetime)
  const [funnelRow] = (
    await db.execute(sql`
      with fs_sends as (
        select es.account_id, es.id as send_id, es.open_count, es.replied_at
        from email_sends es
        join message_templates mt on mt.id = es.template_id
        join accounts a on a.id = es.account_id
        where mt.purpose = 'fs_cross_sell'
          and a.deleted_at is null
          ${territoryClause}
      )
      select
        (select count(distinct account_id) from fs_sends)::int as emailed,
        (select count(distinct account_id) from fs_sends where open_count > 0)::int as opened,
        (select count(distinct account_id) from fs_sends where replied_at is not null)::int as replied,
        (
          select count(distinct o.account_id)::int
          from opportunities o
          join accounts a on a.id = o.account_id
          where o.service_type = 'fs'
            and o.stage not in ('closed_won','closed_lost')
            and o.deleted_at is null
            and a.deleted_at is null
            ${territoryClause}
        ) as open_opp,
        (
          select count(distinct o.account_id)::int
          from opportunities o
          join accounts a on a.id = o.account_id
          where o.service_type = 'fs'
            and o.stage = 'closed_won'
            and o.deleted_at is null
            and a.deleted_at is null
            ${territoryClause}
        ) as won
    `)
  ).rows as Array<{
    emailed: number;
    opened: number;
    replied: number;
    open_opp: number;
    won: number;
  }>;

  const funnel = [
    { label: "Targeted", value: crossSellTargets },
    { label: "Emailed", value: funnelRow?.emailed ?? 0 },
    { label: "Opened", value: funnelRow?.opened ?? 0 },
    { label: "Replied", value: funnelRow?.replied ?? 0 },
    { label: "Open opp", value: funnelRow?.open_opp ?? 0 },
    { label: "Won", value: funnelRow?.won ?? 0 },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  // ---- Render --------------------------------------------------------------

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Welcome back, {session.email.split("@")[0]}.
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {" · "}
            {session.territory === "both"
              ? "All territories"
              : session.territory === "fun_coast"
                ? "Fun Coast"
                : "Space Coast"}
          </p>
        </div>
        {session.role === "admin" ? <SendDigestButton /> : null}
      </section>

      {/* KPI strip ------------------------------------------------------- */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Customers" value={totalCustomers.toLocaleString()} />
        <Stat label="MRR" value={formatCurrencyCompact(totalMrr)} />
        <Stat
          label="FS attach rate"
          value={`${fsAttachRate.toFixed(1)}%`}
          sub={`${fsCustomers} of ${ffCustomers} FF`}
          accent={fsAttachRate < 20 ? "warning" : undefined}
        />
        <Stat
          label="Cross-sell targets"
          value={crossSellTargets.toLocaleString()}
          href="/cross-sell"
        />
        <Stat
          label="Open opportunities"
          value={openOpps.toLocaleString()}
          href="/pipeline"
        />
        <Stat
          label="Today"
          value={(taskCounts.overdue + taskCounts.today).toLocaleString()}
          sub={
            taskCounts.overdue > 0
              ? `${taskCounts.overdue} overdue`
              : `${taskCounts.thisWeek} this week`
          }
          accent={taskCounts.overdue > 0 ? "warning" : undefined}
          href="/today"
        />
      </section>

      {/* MRR by service + concentration --------------------------------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="MRR by service">
          {mrrTotal === 0 ? (
            <p className="text-sm text-slate-500">
              No revenue data yet. Run the billing import to populate
              service profiles.
            </p>
          ) : (
            <div className="space-y-2">
              {(["ff", "fs", "fb", "fg", "fc", "fd"] as const).map((k) => {
                const v = mrrByService[k];
                const pct = mrrTotal > 0 ? (v / mrrTotal) * 100 : 0;
                if (v === 0) return null;
                return (
                  <div key={k}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-slate-900">
                        {SERVICE_LABEL[k]}
                      </span>
                      <span className="tabular-nums text-slate-700">
                        {formatCurrencyCompact(v)}
                        <span className="ml-2 text-xs text-slate-500">
                          {pct.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
                      <div
                        className={`h-full ${SERVICE_TINT[k]}`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Top 10 customer concentration"
          subtitle={
            topCustomers.length > 0 && totalMrr > 0
              ? `Top 10 = ${(
                  (topCustomers.reduce((s, c) => s + c.mrr, 0) / totalMrr) *
                  100
                ).toFixed(1)}% of MRR`
              : undefined
          }
        >
          {topCustomers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No customers in scope yet.
            </p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {topCustomers.map((c, i) => {
                const isOceanBreeze = /ocean breeze/i.test(c.name);
                const flagged = isOceanBreeze || c.pctOfTotal >= 10;
                return (
                  <li
                    key={c.id}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      <span className="mr-2 inline-block w-5 text-right text-xs text-slate-400">
                        {i + 1}.
                      </span>
                      <Link
                        href={`/accounts/${c.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {c.name}
                      </Link>
                      {flagged ? (
                        <span
                          title="High concentration risk"
                          className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700"
                        >
                          {c.pctOfTotal.toFixed(1)}%
                        </span>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-slate-700">
                        {formatCurrencyCompact(c.mrr)}/mo
                      </div>
                      {!flagged ? (
                        <div className="text-xs text-slate-500">
                          {c.pctOfTotal.toFixed(1)}%
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </section>

      {/* FS cross-sell funnel ------------------------------------------- */}
      <Card
        title="FiltaClean cross-sell funnel"
        subtitle="Targeted → emailed → opened → replied → open opp → won"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {funnel.map((step, i) => {
            const prev = i > 0 ? funnel[i - 1].value : null;
            const conv =
              prev != null && prev > 0
                ? `${((step.value / prev) * 100).toFixed(0)}%`
                : null;
            const widthPct = (step.value / funnelMax) * 100;
            return (
              <div
                key={step.label}
                className="rounded-md border border-slate-200 bg-white p-3"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {step.label}
                </div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {step.value.toLocaleString()}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full bg-service-fs"
                    style={{ width: `${Math.max(3, widthPct)}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {conv ? `↓ ${conv} from prior` : "starting set"}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          "Emailed" / "Opened" / "Replied" count distinct accounts that received
          at least one FS cross-sell template send. "Won" is lifetime; the
          others are point-in-time.
        </p>
      </Card>

      {/* Action shortcuts ---------------------------------------------- */}
      <section className="grid gap-4 md:grid-cols-3">
        <ActionCard
          href="/today"
          eyebrow={taskCounts.overdue > 0 ? "Needs attention" : "Today"}
          eyebrowTone={taskCounts.overdue > 0 ? "warning" : "primary"}
          title={
            taskCounts.overdue + taskCounts.today === 0
              ? "You're caught up"
              : `${taskCounts.overdue + taskCounts.today} follow-up${
                  taskCounts.overdue + taskCounts.today === 1 ? "" : "s"
                }`
          }
          body={
            taskCounts.overdue > 0
              ? `${taskCounts.overdue} overdue · ${taskCounts.today} due today · ${taskCounts.thisWeek} later this week.`
              : `${taskCounts.today} due today · ${taskCounts.thisWeek} later this week.`
          }
          cta="Open Today →"
        />
        <ActionCard
          href="/cross-sell"
          eyebrow="Biggest opportunity"
          eyebrowTone="success"
          title={`FiltaClean cross-sell: ${crossSellTargets} targets`}
          body="FF customers without FS — ~70% gross margin service we're leaving on the table."
          cta="Open cross-sell →"
        />
        <ActionCard
          href="/at-risk"
          eyebrow="Retention"
          eyebrowTone="warning"
          title="At-risk customers"
          body="Service overdue, bouncing emails, dormant relationships, stuck FS opps."
          cta="Open at-risk queue →"
        />
      </section>
    </div>
  );
}

// ============================================================================
// UI BITS
// ============================================================================

function Stat({
  label,
  value,
  sub,
  accent,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "warning";
  href?: string;
}) {
  const inner = (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          accent === "warning" ? "text-rose-700" : "text-slate-900"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
        {subtitle ? (
          <span className="text-xs text-slate-500">{subtitle}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ActionCard({
  href,
  eyebrow,
  eyebrowTone,
  title,
  body,
  cta,
}: {
  href: string;
  eyebrow: string;
  eyebrowTone: "primary" | "success" | "warning";
  title: string;
  body: string;
  cta: string;
}) {
  const eyebrowCls =
    eyebrowTone === "warning"
      ? "text-rose-700"
      : eyebrowTone === "success"
        ? "text-emerald-700"
        : "text-filta-blue";
  return (
    <Link
      href={href}
      className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div
        className={`text-xs font-semibold uppercase tracking-wide ${eyebrowCls}`}
      >
        {eyebrow}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
      <div className="mt-3 text-sm font-medium text-slate-900 group-hover:underline">
        {cta}
      </div>
    </Link>
  );
}

// ----------------------------------------------------------------------------
// Compact currency helper. Shows $1.2M for 1.2M, $123K for 123,000, $456 for
// smaller amounts. Matches the brevity the dashboard tiles want — when a rep
// needs the precise dollar figure they click through.
function formatCurrencyCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `$${Math.round(n / 1_000).toLocaleString()}K`;
  }
  return `$${Math.round(n).toLocaleString()}`;
}
