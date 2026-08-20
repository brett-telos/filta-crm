// GET /api/field/symphony-export
//
// CSV of every lead sitting at Service Scheduled (db: negotiation) — the
// handoff file for keying new customers into Filta Symphony. Column order
// mirrors the Symphony lead export (Record ID, Company, Contact, City,
// Phone, ..., Sales Funnel, NCA) so the office can eyeball-match fields,
// plus the extra columns Symphony's customer record wants (address, zip,
// website, email).
//
// Query params:
//   ?stage=scheduled (default) | won  — won exports recently converted
//                                        customers (last 30 days) instead.
//
// Auth: CRM session required; territory scoping applied like everywhere
// else. Linked from the Field Mode Symphony card and usable from a laptop:
//   /api/field/symphony-export

import { NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { accounts, contacts, db } from "@/db";
import { requireSession } from "@/lib/session";
import { formatPhone } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const raw = String(v);
  const s = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const session = await requireSession();
  const url = new URL(req.url);
  const mode = url.searchParams.get("stage") === "won" ? "won" : "scheduled";

  const territoryWhere =
    session.territory === "both"
      ? undefined
      : or(
          eq(accounts.territory, session.territory),
          eq(accounts.territory, "unassigned"),
        );

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      filtaRecordId: accounts.filtaRecordId,
      companyName: accounts.companyName,
      addressLine1: accounts.addressLine1,
      city: accounts.city,
      state: accounts.state,
      zip: accounts.zip,
      county: accounts.county,
      territory: accounts.territory,
      phoneRaw: accounts.phoneRaw,
      phone: accounts.phone,
      website: accounts.website,
      fryerCount: accounts.fryerCount,
      ncaFlag: accounts.ncaFlag,
      ncaName: accounts.ncaName,
      stageChangedAt: accounts.salesFunnelStageChangedAt,
      contactName: contacts.fullName,
      contactEmail: contacts.email,
      contactMobile: contacts.phoneMobile,
    })
    .from(accounts)
    .leftJoin(
      contacts,
      and(
        eq(contacts.accountId, accounts.id),
        eq(contacts.isPrimary, true),
        isNull(contacts.deletedAt),
      ),
    )
    .where(
      and(
        isNull(accounts.deletedAt),
        mode === "scheduled"
          ? and(
              eq(accounts.accountStatus, "prospect"),
              eq(accounts.salesFunnelStage, "negotiation"),
            )
          : and(
              eq(accounts.accountStatus, "customer"),
              gte(accounts.convertedAt, thirtyDaysAgo),
            ),
        territoryWhere,
      ),
    )
    .orderBy(desc(accounts.salesFunnelStageChangedAt))
    .limit(500);

  const header = [
    "Record ID",
    "Company",
    "Contact",
    "City",
    "Phone",
    "Fryers",
    "Sales Funnel",
    "NCA",
    "Street Address",
    "State",
    "Zip",
    "County",
    "Territory",
    "Website",
    "Contact Email",
    "Contact Mobile",
    "Stage Date",
  ];

  const funnelLabel =
    mode === "scheduled" ? "Completed Meeting" : "Customer";

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.filtaRecordId),
        csvCell(r.companyName),
        csvCell(r.contactName),
        csvCell(r.city),
        csvCell(formatPhone(r.phoneRaw ?? r.phone)),
        csvCell(r.fryerCount),
        csvCell(funnelLabel),
        csvCell(r.ncaFlag ? (r.ncaName ?? "Yes") : ""),
        csvCell(r.addressLine1),
        csvCell(r.state),
        csvCell(r.zip),
        csvCell(r.county),
        csvCell(
          r.territory === "fun_coast"
            ? "Fun Coast"
            : r.territory === "space_coast"
              ? "Space Coast"
              : "Unassigned",
        ),
        csvCell(r.website),
        csvCell(r.contactEmail),
        csvCell(r.contactMobile),
        csvCell(r.stageChangedAt.toISOString().slice(0, 10)),
      ].join(","),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="symphony_${mode}_${today}.csv"`,
    },
  });
}
