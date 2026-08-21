// /q/[token] — customer-facing quote viewer.
//
// Public route. No authentication; access is gated entirely by the token
// the customer received in their email. Renders:
//   - A summary panel (company, prepared-by, totals, validity)
//   - The quote PDF inline via iframe (streamed from the public PDF route)
//   - Accept / Decline buttons that POST to a public action
//
// On first view we stamp customer_viewed_at on the quote_version row so
// the rep can see "they opened it" without needing the open-tracking
// pixel to fire.
//
// Standalone layout — no AppNav, no rep-side chrome. Customers shouldn't
// see internal CRM navigation.

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  quoteVersions,
  serviceAgreements,
  users,
} from "@/db";
import { loadQuoteByToken } from "@/lib/public-tokens";
import PublicQuoteActions from "./PublicQuoteActions";

export const dynamic = "force-dynamic";
// No caching — the token-to-row resolution is cheap and we always want a
// fresh view of the quote status (e.g., already accepted by another tab).
export const revalidate = 0;

const SERVICE_LABEL: Record<string, string> = {
  ff: "FiltaFry",
  fs: "FiltaClean",
  fb: "FiltaBio",
  fg: "FiltaGold",
  fc: "FiltaCool",
  fd: "FiltaDrain",
};

export default async function PublicQuotePage({
  params,
}: {
  params: { token: string };
}) {
  const quote = await loadQuoteByToken(params.token);
  if (!quote) {
    // Don't reveal whether the token never existed vs expired vs malformed.
    notFound();
  }

  // Side effect: stamp customer_viewed_at on first view. Idempotent —
  // repeated views update the timestamp so the rep sees the most recent.
  // Done before render so the page state matches what we just persisted.
  await db
    .update(quoteVersions)
    .set({ customerViewedAt: new Date() })
    .where(eq(quoteVersions.id, quote.id));

  // Pull the parent opp + account + sender for the header chrome. Same
  // info that's on the quote PDF, but rendered in HTML so it's scannable
  // on mobile without zooming.
  const [meta] = await db
    .select({
      accountTerritory: accounts.territory,
      oppName: opportunities.name,
      oppServiceType: opportunities.serviceType,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(quoteVersions)
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
    .where(eq(quoteVersions.id, quote.id))
    .limit(1);

  // If this quote has already been accepted, look up the resulting
  // agreement so we can redirect or link the customer to /a/[token].
  const [existingAgreement] =
    quote.status === "accepted"
      ? await db
          .select({
            id: serviceAgreements.id,
            status: serviceAgreements.status,
            publicTokenHash: serviceAgreements.publicTokenHash,
            publicTokenExpiresAt: serviceAgreements.publicTokenExpiresAt,
          })
          .from(serviceAgreements)
          .where(eq(serviceAgreements.quoteVersionId, quote.id))
          .limit(1)
      : [undefined];

  const territoryLabel =
    meta?.accountTerritory === "space_coast" ? "Space Coast" : "Fun Coast";
  const senderName =
    [meta?.senderFirstName, meta?.senderLastName].filter(Boolean).join(" ") ||
    meta?.senderEmail ||
    "your Filta rep";
  const companyName = quote.customerCompanyName;
  const annualValue = formatCurrency(Number(quote.estimatedAnnual ?? 0));

  return (
    <div className="min-h-screen bg-slate-50 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5 px-4">
        {/* Header strip */}
        <div className="rounded-lg bg-filta-blue px-5 py-4 text-white shadow-sm">
          <div className="text-xs uppercase tracking-wider text-white/80">
            Filta {territoryLabel} · Proposal
          </div>
          <div className="mt-1 text-xl font-semibold">
            For {companyName}
          </div>
          <div className="text-sm text-white/90">
            Prepared by {senderName} · Estimated annual value {annualValue}
          </div>
        </div>

        {/* Status banner — what comes next based on current state */}
        <StatusBanner
          status={quote.status}
          existingAgreement={existingAgreement ?? null}
          token={params.token}
        />

        {/* PDF inline. iframe so most browsers render with their built-in
            PDF viewer — easier on mobile than embedding the React-PDF
            output as HTML, and matches what the rep sees. */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Proposal PDF
          </div>
          <iframe
            src={`/api/quotes/public/${encodeURIComponent(params.token)}/pdf`}
            title={`Filta proposal for ${companyName}`}
            className="block h-[70vh] w-full"
          />
        </div>

        {/* Accept / Decline buttons (or sign link if already accepted) */}
        {quote.status === "draft" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This proposal is still a draft and isn&apos;t ready for acceptance
            yet. Your rep will send a final version shortly.
          </div>
        ) : quote.status === "sent" ? (
          <PublicQuoteActions
            token={params.token}
            companyName={companyName}
            annualValue={annualValue}
          />
        ) : null}

        {/* Notes if present */}
        {quote.notes ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes from {senderName}
            </div>
            <div className="whitespace-pre-wrap text-slate-700">
              {quote.notes}
            </div>
          </div>
        ) : null}

        <p className="text-center text-xs text-slate-500">
          Questions? Reply directly to the email this link came from, or
          call your Filta rep.
        </p>
      </div>
    </div>
  );
}

function StatusBanner({
  status,
  existingAgreement,
  token,
}: {
  status: string;
  existingAgreement: {
    id: string;
    status: string;
    publicTokenHash: string | null;
  } | null;
  token: string;
}) {
  if (status === "accepted") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="font-semibold">Thanks — proposal accepted ✓</div>
        <div className="mt-1">
          Your Service Agreement was emailed to you. Sign it digitally any
          time:
        </div>
        {existingAgreement?.publicTokenHash ? (
          <p className="mt-2 text-xs text-emerald-800/80">
            Use the &quot;Sign Service Agreement&quot; link in that email — it
            takes ~30 seconds.
          </p>
        ) : null}
      </div>
    );
  }
  if (status === "declined") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        This proposal was declined. If that was a mistake, reply to your
        Filta rep and we&apos;ll send a fresh version.
      </div>
    );
  }
  if (status === "expired") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
        This proposal expired. Reply to your Filta rep to get a refreshed
        version.
      </div>
    );
  }
  return null;
}

function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
