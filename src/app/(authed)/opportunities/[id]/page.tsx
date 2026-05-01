// /opportunities/[id] — the missing hub.
//
// Aggregates everything for a single opportunity in one place so a rep
// doesn't have to hop between the account detail page, the quote builder,
// and the agreement download to follow a deal end-to-end.
//
// Sections (top to bottom):
//   1. Header — opp name, account link, stage, owner, value, expected close
//   2. Quote versions — every version with inline View/Edit/Send/Accept controls
//   3. Service agreements — download links + signed status
//   4. Open tasks for this opp
//   5. Recent activities filtered to this opp
//
// Replit's recent edits dropped the "Build / send quote" link from the
// account detail's Opportunities card; reps had no path to the quote
// builder. This page is the durable fix — pipeline cards and the account
// detail link here, and from here every per-version action is one click
// away.

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  accounts,
  activities,
  opportunities,
  quoteVersions,
  serviceAgreements,
  users,
} from "@/db";
import { requireSession, canAccessTerritory } from "@/lib/session";
import {
  ACTIVITY_TYPE_LABEL,
  SERVICE_LABEL,
  STAGE_LABEL,
  formatCurrency,
  formatDateTime,
  formatRelative,
} from "@/lib/format";
import { getOpenTasksForAccount } from "../../tasks/actions";
import { TaskRow } from "../../today/TaskRow";
import AcceptQuoteButton from "./quote/AcceptQuoteButton";

export const dynamic = "force-dynamic";

const QUOTE_STATUS_PALETTE: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700",
  sent: "bg-blue-50 text-blue-700",
  accepted: "bg-emerald-50 text-emerald-700",
  declined: "bg-rose-50 text-rose-700",
  expired: "bg-slate-100 text-slate-600",
};

const AGREEMENT_STATUS_PALETTE: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700",
  sent: "bg-blue-50 text-blue-700",
  signed: "bg-emerald-50 text-emerald-700",
  active: "bg-emerald-50 text-emerald-700",
  terminated: "bg-rose-50 text-rose-700",
};

export default async function OpportunityDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();

  // Pull the opp + parent account + owner in one round trip.
  const [opp] = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      stage: opportunities.stage,
      stageChangedAt: opportunities.stageChangedAt,
      serviceType: opportunities.serviceType,
      estimatedValueAnnual: opportunities.estimatedValueAnnual,
      expectedCloseDate: opportunities.expectedCloseDate,
      actualCloseDate: opportunities.actualCloseDate,
      lostReason: opportunities.lostReason,
      deletedAt: opportunities.deletedAt,
      // account
      accountId: accounts.id,
      companyName: accounts.companyName,
      accountTerritory: accounts.territory,
      accountStatus: accounts.accountStatus,
      accountPhone: accounts.phone,
      // owner
      ownerFirstName: users.firstName,
      ownerEmail: users.email,
    })
    .from(opportunities)
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, opportunities.ownerUserId))
    .where(eq(opportunities.id, params.id))
    .limit(1);

  if (!opp || opp.deletedAt) notFound();
  if (
    opp.accountTerritory !== "unassigned" &&
    !canAccessTerritory(session, opp.accountTerritory)
  ) {
    notFound();
  }

  // Parallel pulls for the four sections below the header.
  const [
    quoteRows,
    agreementRows,
    activityRows,
    openTasks,
  ] = await Promise.all([
    // Every quote version for this opp, with the matching service agreement
    // joined in (if accepted). Latest first.
    db
      .select({
        id: quoteVersions.id,
        versionNumber: quoteVersions.versionNumber,
        status: quoteVersions.status,
        estimatedAnnual: quoteVersions.estimatedAnnual,
        sentAt: quoteVersions.sentAt,
        acceptedAt: quoteVersions.acceptedAt,
        createdAt: quoteVersions.createdAt,
        notes: quoteVersions.notes,
        customerContactEmail: quoteVersions.customerContactEmail,
        customerContactName: quoteVersions.customerContactName,
        createdByFirstName: users.firstName,
        agreementId: serviceAgreements.id,
        agreementStatus: serviceAgreements.status,
      })
      .from(quoteVersions)
      .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
      .leftJoin(
        serviceAgreements,
        and(
          eq(serviceAgreements.quoteVersionId, quoteVersions.id),
          isNull(serviceAgreements.deletedAt),
        ),
      )
      .where(
        and(
          eq(quoteVersions.opportunityId, opp.id),
          isNull(quoteVersions.deletedAt),
        ),
      )
      .orderBy(desc(quoteVersions.versionNumber)),
    // Every agreement for this opp's account-via-quote chain. Same data as
    // above but separate so the section can render even if no quotes exist
    // (an agreement might have been created out-of-band).
    db
      .select({
        id: serviceAgreements.id,
        status: serviceAgreements.status,
        termStartDate: serviceAgreements.termStartDate,
        termEndDate: serviceAgreements.termEndDate,
        sentAt: serviceAgreements.sentAt,
        customerSignedAt: serviceAgreements.customerSignedAt,
        customerSignedName: serviceAgreements.customerSignedName,
        createdAt: serviceAgreements.createdAt,
        quoteVersionNumber: quoteVersions.versionNumber,
      })
      .from(serviceAgreements)
      .innerJoin(
        quoteVersions,
        eq(quoteVersions.id, serviceAgreements.quoteVersionId),
      )
      .where(
        and(
          eq(quoteVersions.opportunityId, opp.id),
          isNull(serviceAgreements.deletedAt),
        ),
      )
      .orderBy(desc(serviceAgreements.createdAt)),
    // Recent activities for THIS opp specifically (not the whole account).
    db
      .select({
        id: activities.id,
        type: activities.type,
        direction: activities.direction,
        disposition: activities.disposition,
        subject: activities.subject,
        body: activities.body,
        occurredAt: activities.occurredAt,
        durationMinutes: activities.durationMinutes,
        ownerEmail: users.email,
        ownerFirstName: users.firstName,
      })
      .from(activities)
      .leftJoin(users, eq(activities.ownerUserId, users.id))
      .where(eq(activities.opportunityId, opp.id))
      .orderBy(desc(activities.occurredAt))
      .limit(40),
    // Open tasks for the parent account, filtered down to this opp's
    // tasks in JS below. The shared helper returns account-level tasks.
    getOpenTasksForAccount(opp.accountId),
  ]);

  const oppOpenTasks = openTasks.filter((t) => t.opportunityId === opp.id);
  const draftQuote = quoteRows.find((q) => q.status === "draft");
  const acceptedQuote = quoteRows.find((q) => q.status === "accepted");
  const sentQuote = quoteRows.find((q) => q.status === "sent");
  const ctaTarget = `/opportunities/${opp.id}/quote`;

  return (
    <div className="space-y-6">
      {/* ============================================================== */}
      {/* HEADER                                                          */}
      {/* ============================================================== */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/accounts/${opp.accountId}`}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            ← {opp.companyName}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {opp.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              {SERVICE_LABEL[opp.serviceType] ?? opp.serviceType}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 font-medium ${
                opp.stage === "closed_won"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : opp.stage === "closed_lost"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {STAGE_LABEL[opp.stage] ?? opp.stage}
            </span>
            <span className="text-slate-500">
              {opp.ownerFirstName ?? opp.ownerEmail ?? "unassigned"}
            </span>
            {opp.expectedCloseDate ? (
              <span className="text-slate-500">
                ETA {String(opp.expectedCloseDate)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-semibold text-filta-blue">
            {formatCurrency(opp.estimatedValueAnnual ?? 0)}
          </div>
          <div className="text-xs text-slate-500">estimated annual</div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* PRIMARY CTA — pulls the rep into the right next step            */}
      {/* ============================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {acceptedQuote
              ? `Quote v${acceptedQuote.versionNumber} accepted`
              : sentQuote
                ? `Quote v${sentQuote.versionNumber} sent — awaiting reply`
                : draftQuote
                  ? `Draft v${draftQuote.versionNumber} in progress`
                  : "Build a quote"}
          </div>
          <div className="text-xs text-slate-500">
            {acceptedQuote
              ? "Service agreement generated and emailed; track signature below."
              : sentQuote
                ? "Mark accepted in the Quotes section once the customer confirms."
                : draftQuote
                  ? "Continue editing or send when ready."
                  : "Generate a customer-facing PDF from the line items."}
          </div>
        </div>
        <Link
          href={ctaTarget}
          className="rounded-md bg-filta-blue px-4 py-2 text-sm font-semibold text-white hover:bg-filta-blue-dark"
        >
          {acceptedQuote
            ? "Open quote builder"
            : draftQuote
              ? "Continue draft →"
              : "Build quote →"}
        </Link>
      </div>

      {/* ============================================================== */}
      {/* QUOTES                                                          */}
      {/* ============================================================== */}
      <Card title={`Quotes (${quoteRows.length})`}>
        {quoteRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No quotes yet.{" "}
            <Link
              href={ctaTarget}
              className="text-filta-blue hover:underline"
            >
              Build the first one →
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {quoteRows.map((q) => (
              <li
                key={q.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    v{q.versionNumber}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        QUOTE_STATUS_PALETTE[q.status] ??
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {q.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {q.createdByFirstName ?? "—"} · created{" "}
                    {new Date(q.createdAt as Date).toLocaleDateString()}
                    {q.sentAt ? (
                      <> · sent {new Date(q.sentAt as Date).toLocaleDateString()}</>
                    ) : null}
                    {q.acceptedAt ? (
                      <>
                        {" "}
                        · accepted{" "}
                        {new Date(q.acceptedAt as Date).toLocaleDateString()}
                      </>
                    ) : null}
                  </div>
                  {q.notes ? (
                    <div className="mt-1 max-w-md truncate text-xs text-slate-600">
                      {q.notes}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1.5 text-right">
                  <div className="font-medium text-slate-900">
                    {formatCurrency(Number(q.estimatedAnnual ?? 0))}/yr
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {q.status === "draft" ? (
                      <Link
                        href={ctaTarget}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit / send →
                      </Link>
                    ) : (
                      <a
                        href={`/api/quotes/${q.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Download PDF
                      </a>
                    )}
                    {q.status === "sent" ? (
                      <AcceptQuoteButton
                        quoteVersionId={q.id}
                        customerName={opp.companyName}
                        customerEmail={q.customerContactEmail}
                      />
                    ) : null}
                    {q.agreementId ? (
                      <a
                        href={`/api/agreements/${q.agreementId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        Agreement PDF →
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ============================================================== */}
      {/* SERVICE AGREEMENTS                                              */}
      {/* ============================================================== */}
      {agreementRows.length > 0 ? (
        <Card title={`Service agreements (${agreementRows.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {agreementRows.map((a) => (
              <li
                key={a.id}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div>
                  <div className="font-medium text-slate-900">
                    SA-{a.id.slice(0, 6)} · from quote v{a.quoteVersionNumber}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        AGREEMENT_STATUS_PALETTE[a.status] ??
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {a.termStartDate && a.termEndDate
                      ? `Term ${a.termStartDate} → ${a.termEndDate}`
                      : `Created ${new Date(a.createdAt as Date).toLocaleDateString()}`}
                  </div>
                  {a.customerSignedAt ? (
                    <div className="text-xs text-emerald-700">
                      Signed by {a.customerSignedName ?? "customer"} on{" "}
                      {new Date(a.customerSignedAt as Date).toLocaleDateString()}
                    </div>
                  ) : a.sentAt ? (
                    <div className="text-xs text-slate-500">
                      Awaiting signature — sent{" "}
                      {new Date(a.sentAt as Date).toLocaleDateString()}
                    </div>
                  ) : null}
                </div>
                <a
                  href={`/api/agreements/${a.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download PDF
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ============================================================== */}
      {/* OPEN TASKS for this opp                                         */}
      {/* ============================================================== */}
      {oppOpenTasks.length > 0 ? (
        <Card title={`Open tasks (${oppOpenTasks.length})`}>
          <ul className="divide-y divide-slate-100">
            {oppOpenTasks.map((t) => (
              <li key={t.id}>
                <TaskRow task={t} hideAccountName showBucketDate />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ============================================================== */}
      {/* ACTIVITY (filtered to this opp)                                 */}
      {/* ============================================================== */}
      <Card title={`Activity (${activityRows.length})`}>
        {activityRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing logged on this opportunity yet. Activities appear here when
            you log a call, send a quote, or take any other tracked action
            on this deal.
          </p>
        ) : (
          <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
            {activityRows.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-[10px]">
                  {activityDot(a.type)}
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-slate-900">
                    {ACTIVITY_TYPE_LABEL[a.type] ?? a.type}
                    {a.disposition ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        · {a.disposition.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="text-xs text-slate-500"
                    title={formatDateTime(a.occurredAt)}
                  >
                    {formatRelative(a.occurredAt)}
                  </div>
                </div>
                {a.subject ? (
                  <div className="text-sm font-medium text-slate-900">
                    {a.subject}
                  </div>
                ) : null}
                {a.body ? (
                  <div className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">
                    {a.body}
                  </div>
                ) : null}
                <div className="mt-0.5 text-xs text-slate-500">
                  by {a.ownerFirstName ?? a.ownerEmail ?? "system"}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function activityDot(type: string): string {
  switch (type) {
    case "call":
      return "📞";
    case "email":
      return "✉";
    case "meeting":
      return "🤝";
    case "visit":
      return "📍";
    case "note":
      return "📝";
    case "task":
      return "☐";
    default:
      return "•";
  }
}
