import Link from "next/link";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import { db, accounts, opportunities } from "@/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();

  const [accountCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts);
  const [customerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.accountStatus, "customer"));
  const [funCoastCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.territory, "fun_coast"));
  const [spaceCoastCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.territory, "space_coast"));
  const [oppCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opportunities);
  const [openOppCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(
      and(
        isNotNull(opportunities.accountId),
        sql`${opportunities.stage} not in ('closed_won','closed_lost')`,
      ),
    );

  // FiltaClean cross-sell target count: FF-active customers without FS
  // who have no open FS opp. Shown on the dashboard as a nudge.
  const crossSellResult = await db.execute(sql`
    select count(*)::int as count
    from accounts a
    where a.account_status = 'customer'
      and (a.service_profile->'ff'->>'active')::boolean = true
      and coalesce((a.service_profile->'fs'->>'active')::boolean, false) = false
      and a.deleted_at is null
      and not exists (
        select 1 from opportunities o
        where o.account_id = a.id
          and o.service_type = 'fs'
          and o.stage not in ('closed_won','closed_lost')
      )
  `);
  const crossSellTargets = Number((crossSellResult.rows?.[0] as any)?.count ?? 0);

  return (
    <div className="space-y-8">
      <section>
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
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Accounts" value={accountCount.count} />
        <Stat label="Customers" value={customerCount.count} />
        <Stat label="Fun Coast" value={funCoastCount.count} />
        <Stat label="Space Coast" value={spaceCoastCount.count} />
        <Stat label="Opportunities" value={oppCount.count} />
        <Stat label="Open pipeline" value={openOppCount.count} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/cross-sell"
          className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Biggest opportunity
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            FiltaClean cross-sell: {crossSellTargets} targets
          </div>
          <p className="mt-1 text-sm text-slate-600">
            FF customers without FS — ~70% gross margin service we're leaving on
            the table. Click to open the sortable target list.
          </p>
          <div className="mt-3 text-sm font-medium text-slate-900 group-hover:underline">
            Open cross-sell list →
          </div>
        </Link>

        <Link
          href="/pipeline"
          className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pipeline
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">
            {openOppCount.count} open opportunities
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Drag deals through the funnel. Filter by service type (FF / FS / FB
            / FG / FC / DF).
          </p>
          <div className="mt-3 text-sm font-medium text-slate-900 group-hover:underline">
            Open pipeline board →
          </div>
        </Link>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
