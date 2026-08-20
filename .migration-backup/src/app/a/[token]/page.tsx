// /a/[token] — customer-facing Service Agreement viewer + signature.
//
// Public route. No CRM session; access gated by the token in the URL.
// Renders the multi-page Service Agreement PDF inline plus a
// typed-name signature form. On submit, server-side action stamps
// customer_signed_at + customer_signed_name + IP + user-agent on the
// agreement, transitions status to 'signed', and triggers the rep-side
// notification path.
//
// Standalone layout — no AppNav.

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
import { loadAgreementByToken } from "@/lib/public-tokens";
import PublicAgreementSignForm from "./PublicAgreementSignForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicAgreementPage({
  params,
}: {
  params: { token: string };
}) {
  const agreement = await loadAgreementByToken(params.token);
  if (!agreement) notFound();

  // First-view stamp (idempotent).
  await db
    .update(serviceAgreements)
    .set({ customerViewedAt: new Date() })
    .where(eq(serviceAgreements.id, agreement.id));

  // Pull the parent quote + account + sender for the chrome.
  const [meta] = await db
    .select({
      companyName: quoteVersions.customerCompanyName,
      contactName: quoteVersions.customerContactName,
      contactEmail: quoteVersions.customerContactEmail,
      accountTerritory: accounts.territory,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(serviceAgreements)
    .innerJoin(
      quoteVersions,
      eq(quoteVersions.id, serviceAgreements.quoteVersionId),
    )
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, serviceAgreements.createdByUserId))
    .where(eq(serviceAgreements.id, agreement.id))
    .limit(1);

  const territoryLabel =
    meta?.accountTerritory === "space_coast" ? "Space Coast" : "Fun Coast";
  const senderName =
    [meta?.senderFirstName, meta?.senderLastName].filter(Boolean).join(" ") ||
    meta?.senderEmail ||
    "your Filta rep";
  const companyName = meta?.companyName ?? "your company";
  const isSigned = !!agreement.customerSignedAt;
  const isTerminated = agreement.status === "terminated";

  return (
    <div className="min-h-screen bg-slate-50 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5 px-4">
        <div className="rounded-lg bg-filta-blue px-5 py-4 text-white shadow-sm">
          <div className="text-xs uppercase tracking-wider text-white/80">
            Filta {territoryLabel} · Service Agreement
          </div>
          <div className="mt-1 text-xl font-semibold">For {companyName}</div>
          <div className="text-sm text-white/90">
            From {senderName}
            {agreement.termStartDate && agreement.termEndDate ? (
              <>
                {" "}
                · Term {agreement.termStartDate} → {agreement.termEndDate}
              </>
            ) : null}
          </div>
        </div>

        {/* Status banner depending on signed state */}
        {isSigned ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="font-semibold">
              ✓ Signed by {agreement.customerSignedName ?? "you"} on{" "}
              {new Date(agreement.customerSignedAt as Date).toLocaleDateString()}
            </div>
            <div className="mt-1">
              We&apos;ll be in touch in the next day or two to schedule your
              first visit. Welcome aboard.
            </div>
          </div>
        ) : isTerminated ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            This Service Agreement has been terminated. Reply to{" "}
            {senderName} if you need a new agreement.
          </div>
        ) : null}

        {/* PDF inline */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Service Agreement PDF
          </div>
          <iframe
            src={`/api/agreements/public/${encodeURIComponent(params.token)}/pdf`}
            title={`Filta Service Agreement for ${companyName}`}
            className="block h-[70vh] w-full"
          />
        </div>

        {/* Typed-name signature form (only if not yet signed) */}
        {!isSigned && !isTerminated ? (
          <PublicAgreementSignForm
            token={params.token}
            companyName={companyName}
            defaultName={meta?.contactName ?? ""}
          />
        ) : null}

        <p className="text-center text-xs text-slate-500">
          Questions? Reply directly to the welcome email this link came
          from, or call {senderName}.
        </p>
      </div>
    </div>
  );
}
