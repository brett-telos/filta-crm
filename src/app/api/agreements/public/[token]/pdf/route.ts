// GET /api/agreements/public/[token]/pdf
//
// Token-gated public access to the Service Agreement PDF. Mirrors
// /api/agreements/[id]/pdf but auth is the URL token instead of a CRM
// session.

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  quoteLineItems,
  quoteVersions,
  serviceAgreements,
  users,
} from "@/db";
import { renderServiceAgreementPdf } from "@/lib/pdf/ServiceAgreementDocument";
import { agreementPdfDataFromRow } from "@/lib/pdf/agreement-data";
import { loadAgreementByToken } from "@/lib/public-tokens";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  const agreement = await loadAgreementByToken(params.token);
  if (!agreement) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const [meta] = await db
    .select({
      versionNumber: quoteVersions.versionNumber,
      accountTerritory: accounts.territory,
      accountPhone: accounts.phone,
      customerCompanyName: quoteVersions.customerCompanyName,
      customerAddress: quoteVersions.customerAddress,
      customerContactName: quoteVersions.customerContactName,
      customerContactEmail: quoteVersions.customerContactEmail,
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

  const lines = await db
    .select({
      description: quoteLineItems.description,
      quantity: quoteLineItems.quantity,
      unitPrice: quoteLineItems.unitPrice,
      frequency: quoteLineItems.frequency,
      serviceType: quoteLineItems.serviceType,
    })
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteVersionId, agreement.quoteVersionId))
    .orderBy(asc(quoteLineItems.displayOrder));

  const data = agreementPdfDataFromRow(
    {
      ...agreement,
      versionNumber: meta?.versionNumber ?? 1,
      accountTerritory: meta?.accountTerritory ?? "unassigned",
      customerCompanyName:
        meta?.customerCompanyName ?? "(unknown customer)",
      customerAddress: meta?.customerAddress ?? null,
      customerContactName: meta?.customerContactName ?? null,
      customerContactEmail: meta?.customerContactEmail ?? null,
      customerContactPhone: meta?.accountPhone,
      senderFirstName: meta?.senderFirstName,
      senderLastName: meta?.senderLastName,
      senderEmail: meta?.senderEmail,
    },
    lines,
  );
  const buffer = await renderServiceAgreementPdf(data);

  const safeName = (
    meta?.customerCompanyName ?? "filta"
  )
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const filename = `Filta-ServiceAgreement-${safeName}.pdf`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
