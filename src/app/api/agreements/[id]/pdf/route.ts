// GET /api/agreements/[id]/pdf
//
// Streams a freshly-rendered Service Agreement PDF for a service_agreements
// row. Same pattern as /api/quotes/[id]/pdf — pulls the row + parent quote
// + line items + sender, shapes via agreementPdfDataFromRow, renders to a
// Buffer, returns inline so the browser previews.
//
// Auth: requires a CRM session and territory access to the parent account.
//
// Runtime: Node (PDF rendering needs node:fs internals).

import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  quoteLineItems,
  quoteVersions,
  serviceAgreements,
  users,
} from "@/db";
import { requireSession, canAccessTerritory } from "@/lib/session";
import { renderServiceAgreementPdf } from "@/lib/pdf/ServiceAgreementDocument";
import { agreementPdfDataFromRow } from "@/lib/pdf/agreement-data";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireSession();

  const [row] = await db
    .select({
      id: serviceAgreements.id,
      status: serviceAgreements.status,
      quoteVersionId: serviceAgreements.quoteVersionId,
      versionNumber: quoteVersions.versionNumber,
      accountTerritory: accounts.territory,
      accountPhone: accounts.phone,
      customerCompanyName: quoteVersions.customerCompanyName,
      customerAddress: quoteVersions.customerAddress,
      customerContactName: quoteVersions.customerContactName,
      customerContactEmail: quoteVersions.customerContactEmail,
      customerSignedName: serviceAgreements.customerSignedName,
      customerSignedAt: serviceAgreements.customerSignedAt,
      termStartDate: serviceAgreements.termStartDate,
      termEndDate: serviceAgreements.termEndDate,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
      createdAt: serviceAgreements.createdAt,
    })
    .from(serviceAgreements)
    .innerJoin(
      quoteVersions,
      eq(quoteVersions.id, serviceAgreements.quoteVersionId),
    )
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, serviceAgreements.createdByUserId))
    .where(
      and(
        eq(serviceAgreements.id, params.id),
        isNull(serviceAgreements.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }
  if (
    row.accountTerritory !== "unassigned" &&
    !canAccessTerritory(session, row.accountTerritory)
  ) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const lines = await db
    .select({
      description: quoteLineItems.description,
      quantity: quoteLineItems.quantity,
      unitPrice: quoteLineItems.unitPrice,
      frequency: quoteLineItems.frequency,
      serviceType: quoteLineItems.serviceType,
    })
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteVersionId, row.quoteVersionId))
    .orderBy(asc(quoteLineItems.displayOrder));

  const data = agreementPdfDataFromRow(
    {
      ...row,
      customerContactPhone: row.accountPhone,
    },
    lines,
  );
  const buffer = await renderServiceAgreementPdf(data);

  const safeName = row.customerCompanyName
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
