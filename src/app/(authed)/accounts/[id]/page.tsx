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
import { updateAccountAction } from "./actions";

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

  const [contactRows, oppRows, activityRows] = await Promise.all([
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
          <Card title="Location">
            <dl className="space-y-1 text-sm">
              {acct.addressLine1 ? <Dt>{acct.addressLine1}</Dt> : null}
              {acct.addressLine2 ? <Dt>{acct.addressLine2}</Dt> : null}
              <Dt>
                {[acct.city, acct.state, acct.zip].filter(Boolean).join(", ")}
              </Dt>
              {acct.county ? (
                <Dt className="text-slate-500">{acct.county} County</Dt>
              ) : null}
              {acct.website ? (
                <Dt>
                  <a
                    href={acct.website.startsWith("http") ? acct.website : `https://${acct.website}`}
                    className="text-slate-700 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {acct.website}
                  </a>
                </Dt>
              ) : null}
            </dl>
          </Card>

          <Card title="Services">
            <div className="space-y-2 text-sm">
              {(["ff", "fs", "fb", "fg", "fc", "fd"] as const).map((k) => {
                const entry = sp?.[k] ?? {};
                const active = entry?.active === true;
                const rev = Number(entry?.monthly_revenue ?? 0);
                return (
                  <div
                    key={k}
                    className="flex items-center justify-between border-b border-slate-100 pb-1 last:border-0"
                  >
                    <div>
                      <div className="font-medium text-slate-900">
                        {SERVICE_LABEL[k]}
                      </div>
                      <div className="text-xs uppercase text-slate-500">
                        {active ? "Active" : "—"}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {active ? (
                        <>
                          <div className="font-medium text-slate-900">
                            {formatCurrency(rev)}/mo
                          </div>
                          {entry.last_service_date ? (
                            <div className="text-xs text-slate-500">
                              Last: {entry.last_service_date}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {acct.fryerCount != null ? (
                <div className="pt-2 text-xs text-slate-500">
                  Fryer count: <span className="font-medium text-slate-700">{acct.fryerCount}</span>
                </div>
              ) : null}
            </div>
          </Card>

          <Card title="Contacts">
            {contactRows.length === 0 ? (
              <p className="text-sm text-slate-500">No contacts yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {contactRows.map((c) => (
                  <li key={c.id}>
                    <div className="font-medium text-slate-900">
                      {c.fullName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "—"}
                      {c.isPrimary ? (
                        <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    {c.title ? (
                      <div className="text-xs text-slate-500">{c.title}</div>
                    ) : null}
                    <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-slate-600">
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="hover:underline">
                          {c.email}
                        </a>
                      ) : null}
                      {c.phoneDirect ? (
                        <a href={`tel:${c.phoneDirect}`} className="hover:underline">
                          {formatPhone(c.phoneDirect)}
                        </a>
                      ) : null}
                      {c.phoneMobile ? (
                        <a href={`tel:${c.phoneMobile}`} className="hover:underline">
                          {formatPhone(c.phoneMobile)} (mobile)
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right column — actions. Mobile order-1 puts this first. */}
        <div className="order-1 space-y-4 lg:order-2 lg:col-span-2">
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

          <Card title="Status & notes">
            <form action={updateAccountAction} className="space-y-3 text-sm">
              <input type="hidden" name="accountId" value={acct.id} />
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Status</span>
                <select
                  name="accountStatus"
                  defaultValue={acct.accountStatus}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                >
                  <option value="prospect">Prospect</option>
                  <option value="customer">Customer</option>
                  <option value="churned">Churned</option>
                  <option value="do_not_contact">Do Not Contact</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Notes</span>
                <textarea
                  name="notes"
                  rows={4}
                  defaultValue={acct.notes ?? ""}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-md bg-filta-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-filta-blue-dark"
                >
                  Save
                </button>
              </div>
            </form>
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

function Dt({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`text-slate-700 ${className}`}>{children}</div>;
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
