// /opportunities/[id]/quote — quote builder for an opportunity.
//
// Server-renders the shell (opp + account + latest draft + pricing
// defaults) and hands off to <QuoteBuilder> on the client for the
// interactive line-item editor.
//
// If a draft already exists we open it for editing; if the latest version
// is sent/accepted/declined and the rep wants to revise, they explicitly
// hit "Create new version" which inserts a fresh draft. This keeps the
// "what version am I editing right now" question answerable at a glance.

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  accounts,
  contacts,
  opportunities,
  quoteLineItems,
  quoteVersions,
  servicePricingConfig,
  users,
} from "@/db";
import { requireSession, canAccessTerritory } from "@/lib/session";
import { SERVICE_LABEL, formatCurrency } from "@/lib/format";
import QuoteBuilder, { type QuoteBuilderProps } from "./QuoteBuilder";
import AcceptQuoteButton from "./AcceptQuoteButton";

export const dynamic = "force-dynamic";

export default async function QuoteBuilderPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();

  // Pull opportunity + account + sender context.
  const [opp] = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      accountId: opportunities.accountId,
      serviceType: opportunities.serviceType,
      stage: opportunities.stage,
      estimatedValueAnnual: opportunities.estimatedValueAnnual,
      deletedAt: opportunities.deletedAt,
      // account
      companyName: accounts.companyName,
      accountTerritory: accounts.territory,
      addressLine1: accounts.addressLine1,
      city: accounts.city,
      state: accounts.state,
      zip: accounts.zip,
      fryerCount: accounts.fryerCount,
      serviceProfile: accounts.serviceProfile,
    })
    .from(opportunities)
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .where(eq(opportunities.id, params.id))
    .limit(1);

  if (!opp || opp.deletedAt) notFound();
  if (
    opp.accountTerritory !== "unassigned" &&
    !canAccessTerritory(session, opp.accountTerritory)
  ) {
    notFound();
  }

  // Primary contact for the customer block.
  const [primaryContact] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.accountId, opp.accountId), isNull(contacts.deletedAt)),
    )
    .orderBy(desc(contacts.isPrimary), desc(contacts.updatedAt))
    .limit(1);

  // Pricing defaults (single-row config table).
  const [pricing] = await db.select().from(servicePricingConfig).limit(1);
  const ffPerFryerPerMonth = Number(pricing?.ffPerFryerPerMonth ?? 300);
  const fsPerQuarter = Number(pricing?.fsPerQuarter ?? 750);

  // All non-deleted versions for the right-rail history.
  const allVersions = await db
    .select({
      id: quoteVersions.id,
      versionNumber: quoteVersions.versionNumber,
      status: quoteVersions.status,
      estimatedAnnual: quoteVersions.estimatedAnnual,
      sentAt: quoteVersions.sentAt,
      createdAt: quoteVersions.createdAt,
      createdByFirstName: users.firstName,
    })
    .from(quoteVersions)
    .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
    .where(
      and(
        eq(quoteVersions.opportunityId, opp.id),
        isNull(quoteVersions.deletedAt),
      ),
    )
    .orderBy(desc(quoteVersions.versionNumber));

  // Pick the version we're editing: the latest draft, or seed defaults.
  const editableVersion = allVersions.find((v) => v.status === "draft") ?? null;

  let lines: QuoteBuilderProps["initialLines"] = [];
  let initialNotes = "";
  let initialValidUntil = "";
  let editingVersionId: string | undefined = undefined;

  if (editableVersion) {
    editingVersionId = editableVersion.id;
    const [versionDetails] = await db
      .select({
        notes: quoteVersions.notes,
        validUntil: quoteVersions.validUntil,
      })
      .from(quoteVersions)
      .where(eq(quoteVersions.id, editableVersion.id))
      .limit(1);
    initialNotes = versionDetails?.notes ?? "";
    initialValidUntil = versionDetails?.validUntil ?? "";
    const items = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteVersionId, editableVersion.id))
      .orderBy(asc(quoteLineItems.displayOrder));
    lines = items.map((i) => ({
      id: i.id,
      serviceType: i.serviceType,
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      frequency: i.frequency,
      displayOrder: i.displayOrder,
    }));
  } else {
    // No draft exists. Seed initial lines from the service profile if the
    // opportunity is FS — common case is "build the cross-sell quote".
    const sp = (opp.serviceProfile as Record<string, any>) ?? {};
    const fryers = opp.fryerCount ?? sp?.ff?.fryerCount ?? 4;
    if (opp.serviceType === "fs") {
      lines.push({
        id: null,
        serviceType: "fs",
        description: "FiltaClean — exhaust hood deep clean",
        quantity: 1,
        unitPrice: fsPerQuarter,
        frequency: "quarterly",
        displayOrder: 0,
      });
    } else if (opp.serviceType === "ff") {
      lines.push({
        id: null,
        serviceType: "ff",
        description: `FiltaFry oil filtration — ${fryers} fryer${fryers === 1 ? "" : "s"}`,
        quantity: fryers,
        unitPrice: ffPerFryerPerMonth,
        frequency: "monthly",
        displayOrder: 0,
      });
    }
    // Default validity = 30 days out.
    const expiry = new Date();
    expiry.setUTCDate(expiry.getUTCDate() + 30);
    initialValidUntil = expiry.toISOString().slice(0, 10);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/accounts/${opp.accountId}`}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            ← Back to {opp.companyName}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Build quote
          </h1>
          <p className="text-sm text-slate-600">
            {opp.name} · {SERVICE_LABEL[opp.serviceType] ?? opp.serviceType}
          </p>
        </div>
        {editableVersion ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
            Editing v{editableVersion.versionNumber} · draft
          </span>
        ) : (
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            New quote · v{(allVersions[0]?.versionNumber ?? 0) + 1}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QuoteBuilder
            opportunityId={opp.id}
            quoteVersionId={editingVersionId}
            customer={{
              companyName: opp.companyName,
              contactName: primaryContact?.fullName ?? null,
              contactEmail: primaryContact?.email ?? null,
              addressLine: [opp.addressLine1, opp.city, opp.state, opp.zip]
                .filter(Boolean)
                .join(", ") || null,
            }}
            initialLines={lines}
            initialNotes={initialNotes}
            initialValidUntil={initialValidUntil}
            pricing={{ ffPerFryerPerMonth, fsPerQuarter }}
          />
        </div>

        <aside className="space-y-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Versions ({allVersions.length})
            </h2>
            {allVersions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No quotes yet. Save a draft to start the version history.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {allVersions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-baseline justify-between border-b border-slate-100 pb-2 last:border-0"
                  >
                    <div>
                      <div className="font-medium text-slate-900">
                        v{v.versionNumber}{" "}
                        <span
                          className={`ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                            v.status === "draft"
                              ? "bg-amber-50 text-amber-700"
                              : v.status === "sent"
                                ? "bg-blue-50 text-blue-700"
                                : v.status === "accepted"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {v.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {v.createdByFirstName ?? "—"} ·{" "}
                        {v.sentAt
                          ? `Sent ${new Date(v.sentAt).toLocaleDateString()}`
                          : `Created ${new Date(v.createdAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 text-right">
                      <div className="font-medium text-slate-900">
                        {formatCurrency(Number(v.estimatedAnnual ?? 0))}/yr
                      </div>
                      {v.status !== "draft" ? (
                        <a
                          href={`/api/quotes/${v.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-filta-blue hover:underline"
                        >
                          Download PDF →
                        </a>
                      ) : null}
                      {v.status === "sent" ? (
                        <AcceptQuoteButton
                          quoteVersionId={v.id}
                          customerName={opp.companyName}
                          customerEmail={primaryContact?.email ?? null}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Customer
            </h2>
            <div className="mt-2 space-y-1 text-sm">
              <div className="font-medium text-slate-900">
                {opp.companyName}
              </div>
              {primaryContact ? (
                <>
                  <div className="text-slate-700">
                    {primaryContact.fullName ?? "—"}
                  </div>
                  {primaryContact.email ? (
                    <div className="text-slate-700">{primaryContact.email}</div>
                  ) : (
                    <div className="text-amber-700">
                      No email — required to send the quote.
                    </div>
                  )}
                </>
              ) : (
                <div className="text-amber-700">
                  No primary contact yet. Add one on the account.
                </div>
              )}
              {opp.addressLine1 ? (
                <div className="text-slate-600">{opp.addressLine1}</div>
              ) : null}
              {(opp.city || opp.state || opp.zip) && (
                <div className="text-slate-600">
                  {[opp.city, opp.state, opp.zip].filter(Boolean).join(", ")}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
