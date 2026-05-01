// GET /api/quotes/public/[token]/pdf
//
// Streams the quote PDF to a customer who has the public link. No CRM
// session required — auth is the token in the URL plus the hash check
// in loadQuoteByToken. Mirrors /api/quotes/[id]/pdf (the rep-side route)
// but token-gated.

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  quoteLineItems,
  quoteVersions,
  users,
} from "@/db";
import { renderQuotePdf } from "@/lib/pdf/QuoteDocument";
import { quotePdfDataFromRow } from "@/lib/pdf/quote-data";
import { loadQuoteByToken } from "@/lib/public-tokens";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  const quote = await loadQuoteByToken(params.token);
  if (!quote) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const [meta] = await db
    .select({
      accountTerritory: accounts.territory,
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

  const lines = await db
    .select({
      description: quoteLineItems.description,
      quantity: quoteLineItems.quantity,
      unitPrice: quoteLineItems.unitPrice,
      frequency: quoteLineItems.frequency,
      serviceType: quoteLineItems.serviceType,
    })
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteVersionId, quote.id))
    .orderBy(asc(quoteLineItems.displayOrder));

  const data = quotePdfDataFromRow(
    {
      ...quote,
      accountTerritory: meta?.accountTerritory ?? "unassigned",
      senderFirstName: meta?.senderFirstName,
      senderLastName: meta?.senderLastName,
      senderEmail: meta?.senderEmail,
    },
    lines,
  );
  const buffer = await renderQuotePdf(data);

  const safeName = quote.customerCompanyName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const filename = `Filta-Quote-${safeName}-v${quote.versionNumber}.pdf`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
