// /leads/board — Kanban over the lead funnel.
//
// Mirrors /pipeline's structure (HTML5 drag-drop, mobile select fallback)
// but operates on accounts.sales_funnel_stage instead of opportunities.stage.
//
// Why a separate board route from /pipeline:
//   - /pipeline is service-deal centric (one card per opportunity); a single
//     account with both an FF and FS opp shows up twice. That's correct for
//     deal-level forecasting but confusing for "where are my leads".
//   - /leads/board is account-centric; one card per prospect account. Stages
//     are the same vocabulary, but the unit of work is "this lead" not
//     "this opportunity".
//
// Card content focuses on what a rep needs to triage a lead at a glance:
// company, city, NCA flag, fryer count (proxy for deal size), days in stage
// (the staleness signal from /leads list), and last activity timestamp.

import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, accounts, activities } from "@/db";
import { requireSession } from "@/lib/session";
import LeadsBoard, { type LeadCard } from "./LeadsBoard";

export const dynamic = "force-dynamic";

export default async function LeadsBoardPage({
  searchParams,
}: {
  searchParams?: { territory?: string };
}) {
  const session = await requireSession();
  const territoryFilter = searchParams?.territory ?? "all";

  const conditions = [
    isNull(accounts.deletedAt),
    eq(accounts.accountStatus, "prospect"),
  ];
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

  // Cap at 500 cards on the board — past that, drag-drop becomes useless and
  // the user should narrow via /leads list filters first. Active leads in a
  // small franchise will rarely come close to this.
  const rows = await db
    .select({
      id: accounts.id,
      companyName: accounts.companyName,
      city: accounts.city,
      territory: accounts.territory,
      salesFunnelStage: accounts.salesFunnelStage,
      salesFunnelStageChangedAt: accounts.salesFunnelStageChangedAt,
      fryerCount: accounts.fryerCount,
      ncaFlag: accounts.ncaFlag,
      ncaName: accounts.ncaName,
      lastActivityAt: sql<Date | null>`(
        select max(${activities.occurredAt})
        from ${activities}
        where ${activities.accountId} = ${accounts.id}
      )`,
    })
    .from(accounts)
    .where(and(...conditions))
    .limit(500);

  const cards: LeadCard[] = rows.map((r) => ({
    id: r.id,
    companyName: r.companyName,
    city: r.city,
    territory: r.territory,
    salesFunnelStage: r.salesFunnelStage as LeadCard["salesFunnelStage"],
    salesFunnelStageChangedAt: (r.salesFunnelStageChangedAt as Date)
      .toISOString(),
    fryerCount: r.fryerCount,
    ncaFlag: r.ncaFlag,
    ncaName: r.ncaName,
    lastActivityAt: r.lastActivityAt
      ? (r.lastActivityAt as unknown as Date).toISOString()
      : null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Leads board
          </h1>
          <p className="text-sm text-slate-600">
            {cards.length} {cards.length === 1 ? "lead" : "leads"} ·{" "}
            <Link href="/leads" className="text-filta-blue hover:underline">
              List view →
            </Link>
          </p>
        </div>

        {session.territory === "both" ? (
          <nav className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
            {["all", "fun_coast", "space_coast"].map((t) => {
              const active = territoryFilter === t;
              const label =
                t === "all"
                  ? "All"
                  : t === "fun_coast"
                    ? "Fun Coast"
                    : "Space Coast";
              const href = t === "all" ? "/leads/board" : `/leads/board?territory=${t}`;
              return (
                <Link
                  key={t}
                  href={href}
                  className={`rounded-md px-2.5 py-1 ${
                    active
                      ? "bg-filta-blue text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      <LeadsBoard initialCards={cards} />
    </div>
  );
}
