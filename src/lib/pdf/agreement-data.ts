// Pure helper for shaping a service_agreements row + its quote line items
// into the AgreementPdfData payload the renderer expects. Lives outside the
// server-actions file so both the accept-quote action (in TX1, before
// emailing) and the /api/agreements/[id]/pdf route can call it.

import type { AgreementPdfData } from "./ServiceAgreementDocument";

export function agreementPdfDataFromRow(
  row: {
    id: string;
    status: "draft" | "sent" | "signed" | "active" | "terminated";
    quoteVersionId: string;
    versionNumber: number;
    accountTerritory: "fun_coast" | "space_coast" | "unassigned";
    customerCompanyName: string;
    customerAddress: unknown;
    customerContactName: string | null;
    customerContactEmail: string | null;
    customerContactPhone?: string | null;
    customerSignedName: string | null;
    customerSignedAt: Date | null;
    termStartDate: string | null;
    termEndDate: string | null;
    senderFirstName?: string | null;
    senderLastName?: string | null;
    senderEmail?: string | null;
    createdAt: Date;
  },
  lines: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    frequency: "per_visit" | "monthly" | "quarterly" | "annual" | "one_time";
    serviceType: "ff" | "fs" | "fb" | "fg" | "fc" | "fd" | null;
  }>,
): AgreementPdfData {
  const addr = (row.customerAddress as Record<string, string | null>) ?? {};
  return {
    agreementRef: `SA-${row.id.slice(0, 6)}`,
    status: row.status,
    territory: row.accountTerritory,
    customer: {
      companyName: row.customerCompanyName,
      contactName: row.customerContactName,
      contactEmail: row.customerContactEmail,
      contactPhone: row.customerContactPhone,
      address: addr,
    },
    preparedBy: {
      name:
        [row.senderFirstName, row.senderLastName].filter(Boolean).join(" ") ||
        row.senderEmail ||
        "Filta",
      email: row.senderEmail,
    },
    effectiveDate: row.createdAt,
    termStartDate: row.termStartDate ? new Date(row.termStartDate) : null,
    termEndDate: row.termEndDate ? new Date(row.termEndDate) : null,
    customerSignedName: row.customerSignedName,
    customerSignedAt: row.customerSignedAt,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      frequency: l.frequency,
      serviceType: l.serviceType,
    })),
  };
}
