// Account detail + activity timeline. One page, three columns on desktop:
// left = account facts (address, phone, services, fryers), right = quick-log
// activity form + notes form, bottom-spanning = timeline of activities +
// open opportunities.

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  accounts,
  contacts,
  opportunities,
  activities,
  users,
  emailSends,
  serviceAgreements,
} from "@/db";
import { requireSession, canAccessTerritory } from "@/lib/session";
import {
  ACCOUNT_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
  SERVICE_LABEL,
  STAGE_LABEL,
  TERRITORY_LABEL,
  formatCurrency,
  formatDateTime,
  formatPhone,
  formatRelative,
} from "@/lib/format";
import LogActivityForm from "./LogActivityForm";
import SalesFunnelWidget from "./SalesFunnelWidget";
import EditableInfoCard from "./EditableInfoCard";
import EditableServicesCard from "./EditableServicesCard";
import EditableContactsCard from "./EditableContactsCard";
import StatusNotesForm from "./StatusNotesForm";
import { getOpenTasksForAccount } from "../../tasks/actions";
import { TaskRow } from "../../today/TaskRow";
import { QuickAddTask } from "../../today/QuickAddTask";

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();

  const [acct] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, params.id), isNull(accounts.deletedAt)))
    .limit(1);

  if (!acct) notFound();

  // Territory gate
  if (
    acct.territory !== "unassigned" &&
    (acct.territory === "fun_coast" || acct.territory === "space_coast") &&
    !canAccessTerritory(session, acct.territory)
  ) {
    notFound();
  }

  const [contactRows, oppRows, activityRows, openTasks, emailRows, agreementRows] =
    await Promise.all([
      db
        .select()
        .from(contacts)
        .where(and(eq(contacts.accountId, acct.id), isNull(contacts.deletedAt)))
        .orderBy(desc(contacts.isPrimary)),
      db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.accountId, acct.id),
            isNull(opportunities.deletedAt),
          ),
        )
        .orderBy(desc(opportunities.stageChangedAt)),
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
        .where(eq(activities.accountId, acct.id))
        .orderBy(desc(activities.occurredAt))
        .limit(100),
      getOpenTasksForAccount(acct.id),
      // Last 10 sent (or attempted) emails — shown as a compact history card.
      // Ordered by createdAt so a queued/failed row still shows up in the
      // expected slot even if sentAt never got stamped. Includes engagement
      // counters from W4.1 (open_count, click_count, replied_at) so the rep
      // can see "sent 3d ago, opened 2x, replied" without leaving the page.
      db
        .select({
          id: emailSends.id,
          subject: emailSends.subject,
          toEmail: emailSends.toEmail,
          status: emailSends.status,
          providerError: emailSends.providerError,
          sentAt: emailSends.sentAt,
          createdAt: emailSends.createdAt,
          openCount: emailSends.openCount,
          clickCount: emailSends.clickCount,
          repliedAt: emailSends.repliedAt,
          lastEventAt: emailSends.lastEventAt,
          lastEventType: emailSends.lastEventType,
          senderFirstName: users.firstName,
          senderEmail: users.email,
        })
        .from(emailSends)
        .leftJoin(users, eq(emailSends.sentByUserId, users.id))
        .where(eq(emailSends.accountId, acct.id))
        .orderBy(desc(emailSends.createdAt))
        .limit(10),
      // Service agreements for this account. Shown as a card on the right
      // column when at least one exists; gives the rep a one-click path to
      // the signable PDF and surfaces the term dates.
      db
        .select({
          id: serviceAgreements.id,
          status: serviceAgreements.status,
          termStartDate: serviceAgreements.termStartDate,
          termEndDate: serviceAgreements.termEndDate,
          customerSignedAt: serviceAgreements.customerSignedAt,
          customerSignedName: serviceAgreements.customerSignedName,
          sentAt: serviceAgreements.sentAt,
          createdAt: serviceAgreements.createdAt,
        })
        .from(serviceAgreements)
        .where(
          and(
            eq(serviceAgreements.accountId, acct.id),
            isNull(serviceAgreements.deletedAt),
          ),
        )
        .orderBy(desc(serviceAgreements.createdAt))
        .limit(5),
    ]);

  const sp = (acct.serviceProfile as Record<string, any>) ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/accounts"
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            ← All accounts
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {acct.companyName}
          </h1>
          {acct.dbaName ? (
            <p className="text-sm text-slate-500">dba {acct.dbaName}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              {TERRITORY_LABEL[acct.territory]}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
              {ACCOUNT_STATUS_LABEL[acct.accountStatus]}
            </span>
            {acct.ncaFlag ? (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                NCA{acct.ncaName ? `: ${acct.ncaName}` : ""}
              </span>
            ) : null}
          </div>
        </div>

        {acct.phone ? (
          <a
            href={`tel:${acct.phone}`}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-filta-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-filta-blue-dark sm:w-auto"
          >
            <span aria-hidden>📞</span>
            <span>Call {formatPhone(acct.phone)}</span>
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column — facts. On mobile, shown BELOW the quick-log column
            so the primary action is within thumb reach right after the
            header. */}
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-1">
          <EditableInfoCard
            acct={{
              id: acct.id,
              companyName: acct.companyName,
              dbaName: acct.dbaName,
              addressLine1: acct.addressLine1,
              addressLine2: acct.addressLine2,
              city: acct.city,
              state: acct.state,
              zip: acct.zip,
              county: acct.county,
              phone: acct.phone,
              website: acct.website,
              industrySegment: acct.industrySegment,
              leadSource: acct.leadSource,
              fryerCount: acct.fryerCount,
              ncaFlag: acct.ncaFlag,
              ncaName: acct.ncaName,
            }}
          />

          <EditableServicesCard accountId={acct.id} serviceProfile={sp} />

          <EditableContactsCard
            accountId={acct.id}
            contacts={contactRows.map((c) => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              fullName: c.fullName,
              title: c.title,
              email: c.email,
              phoneDirect: c.phoneDirect,
              phoneMobile: c.phoneMobile,
              decisionMakerRole: c.decisionMakerRole,
              preferredChannel: c.preferredChannel,
              isPrimary: c.isPrimary,
            }))}
          />
        </div>

        {/* Right column — actions. Mobile order-1 puts this first. */}
        <div className="order-1 space-y-4 lg:order-2 lg:col-span-2">
          {acct.accountStatus === "prospect" ? (
            <Card title="Sales funnel">
              <SalesFunnelWidget
                accountId={acct.id}
                companyName={acct.companyName}
                currentStage={acct.salesFunnelStage as
                  | "new_lead"
                  | "contacted"
                  | "qualified"
                  | "proposal"
                  | "negotiation"
                  | "closed_won"
                  | "closed_lost"}
                stageChangedAt={(
                  acct.salesFunnelStageChangedAt as Date
                ).toISOString()}
              />
            </Card>
          ) : null}

          <Card title={`Next steps${openTasks.length ? ` (${openTasks.length})` : ""}`}>
            {openTasks.length === 0 ? (
              <p className="mb-3 text-sm text-slate-500">
                No follow-ups scheduled. Add one to make sure this account
                doesn&apos;t go cold.
              </p>
            ) : (
              <ul className="mb-3 divide-y divide-slate-100">
                {openTasks.map((t) => (
                  <li key={t.id}>
                    <TaskRow task={t} hideAccountName showBucketDate />
                  </li>
                ))}
              </ul>
            )}
            <QuickAddTask accountId={acct.id} />
          </Card>

          <Card title="Log an activity">
            <LogActivityForm accountId={acct.id} />
          </Card>

          <Card title="Opportunities">
            {oppRows.length === 0 ? (
              <p className="text-sm text-slate-500">
                No opportunities yet. They'll be created automatically when
                fryer count is known (FiltaFry) or via the cross-sell list
                (FiltaClean).
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {oppRows.map((o) => (
                  <li key={o.id} className="flex items-start justify-between py-2">
                    <div>
                      <div className="font-medium text-slate-900">{o.name}</div>
                      <div className="text-xs text-slate-500">
                        {SERVICE_LABEL[o.serviceType] ?? o.serviceType} ·{" "}
                        {STAGE_LABEL[o.stage] ?? o.stage}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-medium text-slate-900">
                        {formatCurrency(o.estimatedValueAnnual ?? 0)}
                      </div>
                      {o.expectedCloseDate ? (
                        <div className="text-xs text-slate-500">
                          ETA {String(o.expectedCloseDate)}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {agreementRows.length > 0 ? (
            <Card title={`Service agreements (${agreementRows.length})`}>
              <ul className="divide-y divide-slate-100 text-sm">
                {agreementRows.map((a) => {
                  const ref = `SA-${a.id.slice(0, 6)}`;
                  return (
                    <li
                      key={a.id}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">
                          {ref}
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                              a.status === "signed" || a.status === "active"
                                ? "bg-emerald-50 text-emerald-700"
                                : a.status === "sent"
                                  ? "bg-blue-50 text-blue-700"
                                  : a.status === "terminated"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-amber-50 text-amber-700"
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
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card
            title={`Emails sent${emailRows.length ? ` (${emailRows.length})` : ""}`}
          >
            {emailRows.length === 0 ? (
              <p className="text-sm text-slate-500">
                No emails sent from the CRM yet. Use the cross-sell dashboard
                to fire a templated send and it will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {emailRows.map((e) => {
                  const when = e.sentAt ?? e.createdAt;
                  return (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">
                          {e.subject}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          to {e.toEmail}
                          {e.senderFirstName ? (
                            <> · by {e.senderFirstName}</>
                          ) : null}
                        </div>
                        {e.status === "failed" && e.providerError ? (
                          <div className="mt-0.5 text-xs text-red-700">
                            {e.providerError}
                          </div>
                        ) : null}
                        <EngagementSummary
                          openCount={e.openCount}
                          clickCount={e.clickCount}
                          repliedAt={e.repliedAt}
                          lastEventAt={e.lastEventAt}
                        />
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <EmailStatusPill
                          status={e.status}
                          repliedAt={e.repliedAt}
                          openCount={e.openCount}
                        />
                        <span
                          className="text-xs text-slate-500"
                          title={formatDateTime(when)}
                        >
                          {formatRelative(when)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Status & notes">
            <StatusNotesForm
              accountId={acct.id}
              accountStatus={acct.accountStatus}
              legacyNote={acct.notes}
              notes={activityRows
                .filter((a) => a.type === "note")
                .slice(0, 20)
                .map((a) => ({
                  id: a.id,
                  body: a.body,
                  occurredAt: a.occurredAt,
                  ownerFirstName: a.ownerFirstName,
                  ownerEmail: a.ownerEmail,
                }))}
            />
          </Card>
        </div>
      </div>

      <Card title={`Activity timeline (${activityRows.length})`}>
        {activityRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing logged yet. Use the form above to start the timeline.
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
                    {a.durationMinutes ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        · {a.durationMinutes}m
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

// Compact status pill for email_sends rows. Colors chosen to match the rest
// of the app — emerald for happy path, amber for in-flight/unknown, rose for
// hard failures so a rep can scan the list and spot problems at a glance.
type EmailStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed";

const EMAIL_STATUS_STYLE: Record<EmailStatus, { cls: string; label: string }> = {
  queued: {
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Queued",
  },
  sent: {
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Sent",
  },
  delivered: {
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Delivered",
  },
  bounced: {
    cls: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Bounced",
  },
  complained: {
    cls: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Complained",
  },
  failed: {
    cls: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Failed",
  },
};

// Pill priority: replied > opened/clicked > delivery status. The "did it
// land?" question is most important once a reply happens, then "did they
// engage?", then the raw delivery status.
function EmailStatusPill({
  status,
  repliedAt,
  openCount,
}: {
  status: EmailStatus;
  repliedAt?: Date | null;
  openCount?: number;
}) {
  if (repliedAt) {
    return (
      <span className="inline-flex items-center rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
        Replied
      </span>
    );
  }
  if ((openCount ?? 0) > 0 && (status === "sent" || status === "delivered")) {
    return (
      <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
        Opened
      </span>
    );
  }
  const { cls, label } = EMAIL_STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

// Sub-line under the email subject summarizing engagement counters. Hidden
// entirely when there's no signal yet (avoids visual noise on freshly-sent
// rows that haven't been opened).
function EngagementSummary({
  openCount,
  clickCount,
  repliedAt,
  lastEventAt,
}: {
  openCount: number;
  clickCount: number;
  repliedAt: Date | null;
  lastEventAt: Date | null;
}) {
  if (!openCount && !clickCount && !repliedAt) return null;
  const parts: string[] = [];
  if (openCount > 0) {
    parts.push(`opened ${openCount}×`);
  }
  if (clickCount > 0) {
    parts.push(`${clickCount} click${clickCount === 1 ? "" : "s"}`);
  }
  if (repliedAt) {
    parts.push(`replied ${formatRelative(repliedAt)}`);
  } else if (lastEventAt) {
    parts.push(`last event ${formatRelative(lastEventAt)}`);
  }
  return (
    <div className="mt-0.5 text-xs text-emerald-700">{parts.join(" · ")}</div>
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
