// Pipeline Kanban board. One board, filterable by service type. Displays
// every non-deleted opportunity the current user can see (territory scoped).
// Drag-drop column moves are handled client-side with optimistic UI.

import Link from "next/link";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, accounts, opportunities, tasks, users } from "@/db";
import { requireSession } from "@/lib/session";
import PipelineBoard, { type PipelineCard } from "./PipelineBoard";

export const dynamic = "force-dynamic";

type Service = "ff" | "fs" | "fb" | "fg" | "fc" | "fd";
// Abbrev order matches brand guidelines (FF/FS/FB/FG/FC/FD).
const SERVICES: { value: Service | "all"; label: string }[] = [
  { value: "all", label: "All services" },
  { value: "ff", label: "FiltaFry" },
  { value: "fs", label: "FiltaClean" },
  { value: "fb", label: "FiltaBio" },
  { value: "fg", label: "FiltaGold" },
  { value: "fc", label: "FiltaCool" },
  { value: "fd", label: "FiltaDrain" },
];

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { service?: string };
}) {
  const session = await requireSession();

  const serviceFilter = (searchParams?.service ?? "all") as
    | Service
    | "all";

  const conditions = [isNull(opportunities.deletedAt)];

  if (
    serviceFilter !== "all" &&
    (["ff", "fs", "fb", "fg", "fc", "fd"] as const).includes(serviceFilter as Service)
  ) {
    conditions.push(eq(opportunities.serviceType, serviceFilter as Service));
  }

  // Territory scoping via accounts join
  const rows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      stage: opportunities.stage,
      serviceType: opportunities.serviceType,
      estimatedValueAnnual: opportunities.estimatedValueAnnual,
      stageChangedAt: opportunities.stageChangedAt,
      accountId: accounts.id,
      accountName: accounts.companyName,
      accountTerritory: accounts.territory,
      ownerFirstName: users.firstName,
      ownerEmail: users.email,
    })
    .from(opportunities)
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, opportunities.ownerUserId))
    .where(and(...conditions, isNull(accounts.deletedAt)))
    .orderBy(desc(opportunities.stageChangedAt));

  // Territory filter in-code (could push into SQL too; keeping it here makes
  // the scoping rule obvious and testable).
  const visible = rows.filter((r) => {
    if (session.territory === "both") return true;
    return (
      r.accountTerritory === session.territory ||
      r.accountTerritory === "unassigned"
    );
  });

  // Batch-fetch open task counts for the visible opportunities. One round trip,
  // grouped by opportunity_id. Skipped when there are no visible cards.
  const taskCountByOpp = new Map<string, number>();
  if (visible.length > 0) {
    const ids = visible.map((r) => r.id);
    const counts = await db
      .select({
        opportunityId: tasks.opportunityId,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.opportunityId, ids),
          eq(tasks.status, "open"),
        ),
      )
      .groupBy(tasks.opportunityId);
    for (const row of counts) {
      if (row.opportunityId) taskCountByOpp.set(row.opportunityId, row.count);
    }
  }

  const cards: PipelineCard[] = visible.map((r) => ({
    id: r.id,
    name: r.name,
    stage: r.stage as PipelineCard["stage"],
    serviceType: r.serviceType,
    accountId: r.accountId,
    accountName: r.accountName,
    ownerFirstName: r.ownerFirstName,
    ownerEmail: r.ownerEmail,
    estimatedValueAnnual: r.estimatedValueAnnual ? String(r.estimatedValueAnnual) : null,
    stageChangedAt: (r.stageChangedAt as Date).toISOString(),
    openTaskCount: taskCountByOpp.get(r.id) ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pipeline
          </h1>
          <p className="text-sm text-slate-600">
            {cards.length} {cards.length === 1 ? "opportunity" : "opportunities"}
            {serviceFilter !== "all"
              ? ` · ${SERVICES.find((s) => s.value === serviceFilter)?.label}`
              : ""}
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
          {SERVICES.map((s) => {
            const href =
              s.value === "all" ? "/pipeline" : `/pipeline?service=${s.value}`;
            const active = serviceFilter === s.value;
            return (
              <Link
                key={s.value}
                href={href}
                className={`rounded-md px-2.5 py-1 ${
                  active
                    ? "bg-filta-blue text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <PipelineBoard initialCards={cards} />
    </div>
  );
}
