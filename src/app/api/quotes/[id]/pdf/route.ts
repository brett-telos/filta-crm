// GET /api/quotes/[id]/pdf
//
// Streams a freshly-rendered Quote PDF for a quote_versions row. The
// component reads frozen customer + line snapshots so the PDF the customer
// originally received is reproducible — but the rendering itself happens
// on every request, which keeps us out of the "store binary blobs in
// Postgres" business and ensures that a brand polish lands everywhere
// without a re-export step.
//
// Auth: requires a CRM session and the caller must have territory access
// to the parent account. We don't expose this as an unauthed public link
// in v1; if a customer needs to re-download, the rep can resend the
// original email.
//
// Runtime: Node (PDF rendering needs node:fs internals — won't run on
// edge).

import { NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  quoteLineItems,
  quoteVersions,
  users,
} from "@/db";
import { requireSession, canAccessTerritory } from "@/lib/session";
import { renderQuotePdf } from "@/lib/pdf/QuoteDocument";
import { quotePdfDataFromRow } from "@/lib/pdf/quote-data";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // Auth gate. requireSession() throws on missing session — the route
  // group at /api isn't behind middleware, so we enforce here.
  const session = await requireSession();

  const [row] = await db
    .select({
      id: quoteVersions.id,
      opportunityId: quoteVersions.opportunityId,
      versionNumber: quoteVersions.versionNumber,
      status: quoteVersions.status,
      customerCompanyName: quoteVersions.customerCompanyName,
      customerAddress: quoteVersions.customerAddress,
      customerContactName: quoteVersions.customerContactName,
      customerContactEmail: quoteVersions.customerContactEmail,
      validUntil: quoteVersions.validUntil,
      notes: quoteVersions.notes,
      subtotalMonthly: quoteVersions.subtotalMonthly,
      subtotalQuarterly: quoteVersions.subtotalQuarterly,
      subtotalOneTime: quoteVersions.subtotalOneTime,
      estimatedAnnual: quoteVersions.estimatedAnnual,
      accountTerritory: accounts.territory,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(quoteVersions)
    .innerJoin(opportunities, eq(opportunities.id, quoteVersions.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .leftJoin(users, eq(users.id, quoteVersions.createdByUserId))
    .where(
      and(
        eq(quoteVersions.id, params.id),
        isNull(quoteVersions.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (
    row.accountTerritory !== "unassigned" &&
    !canAccessTerritory(session, row.accountTerritory)
  ) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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
    .where(eq(quoteLineItems.quoteVersionId, row.id))
    .orderBy(asc(quoteLineItems.displayOrder));

  const data = quotePdfDataFromRow(row, lines);
  const buffer = await renderQuotePdf(data);

  // Inline disposition so the browser previews instead of forcing a save —
  // reps usually want to glance at it before sending. Filename is the
  // company-and-version slug.
  const safeName = row.customerCompanyName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const filename = `Filta-Quote-${safeName}-v${row.versionNumber}.pdf`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
