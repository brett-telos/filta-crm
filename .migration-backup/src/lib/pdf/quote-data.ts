// Pure helper for shaping a quote_versions row + its line items into the
// QuotePdfData payload the renderer expects. Lives outside the server-
// actions file because Next.js requires every export of a "use server"
// module to be an async RPC handler — and this is a sync function called
// from both the action (in TX1, before email send) and the /api download
// route (each PDF render).

import type { QuotePdfData } from "./QuoteDocument";

export function quotePdfDataFromRow(
  row: {
    id: string;
    opportunityId: string;
    versionNumber: number;
    status: "draft" | "sent" | "accepted" | "declined" | "expired";
    customerCompanyName: string;
    customerAddress: unknown;
    customerContactName: string | null;
    customerContactEmail: string | null;
    validUntil: string | null;
    notes: string | null;
    subtotalMonthly: string;
    subtotalQuarterly: string;
    subtotalOneTime: string;
    estimatedAnnual: string;
    accountTerritory: "fun_coast" | "space_coast" | "unassigned";
    senderFirstName?: string | null;
    senderLastName?: string | null;
    senderEmail?: string | null;
  },
  lines: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    frequency: "per_visit" | "monthly" | "quarterly" | "annual" | "one_time";
    serviceType: "ff" | "fs" | "fb" | "fg" | "fc" | "fd" | null;
  }>,
): QuotePdfData {
  const addr = (row.customerAddress as Record<string, string | null>) ?? {};
  return {
    quoteRef: `Q-${row.opportunityId.slice(0, 6)}-v${row.versionNumber}`,
    status: row.status,
    territory: row.accountTerritory,
    customer: {
      companyName: row.customerCompanyName,
      contactName: row.customerContactName,
      contactEmail: row.customerContactEmail,
      address: addr,
    },
    preparedBy: {
      name:
        [row.senderFirstName, row.senderLastName].filter(Boolean).join(" ") ||
        row.senderEmail ||
        "Filta",
      email: row.senderEmail,
    },
    preparedAt: new Date(),
    validUntil: row.validUntil ? new Date(row.validUntil) : null,
    lines: lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      frequency: l.frequency,
      serviceType: l.serviceType,
    })),
    totals: {
      subtotalMonthly: Number(row.subtotalMonthly),
      subtotalQuarterly: Number(row.subtotalQuarterly),
      subtotalOneTime: Number(row.subtotalOneTime),
      estimatedAnnual: Number(row.estimatedAnnual),
    },
    notes: row.notes ?? undefined,
  };
}
