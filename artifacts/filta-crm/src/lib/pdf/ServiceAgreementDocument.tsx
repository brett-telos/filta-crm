// Service Agreement PDF — multi-page signable document modeled on the
// corporate Filta Service Agreement (docs/reference/CorporateFiltaServiceAgreement.docx).
//
// Generated when a customer accepts a quote. Page structure:
//   Page 1   — Cover: services × frequency × pricing × opt-in grid,
//              customer info block, FiltaGold opt-in selector, QA contact,
//              signature lines.
//   Pages 2-3 — Terms & Conditions: 3-yr term + auto-renew, NCA exception,
//              opportunity to cure, indemnity, NJ disputes, Net 7, $25 late
//              fee, 5% annual cap, confidentiality, severability.
//   Pages 3-4 — Scope of Service: per-service description for each line
//              item active in this agreement (FF, FB, FG, FS, FC, FD).
//
// Same React-PDF stack and brand palette as QuoteDocument so the two
// documents look like they came from the same hand. Customer reads the
// quote first; if they say yes, they get the Service Agreement which
// references the same line items and pricing.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";

// ============================================================================
// TYPES
// ============================================================================

export type AgreementPdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  frequency: "per_visit" | "monthly" | "quarterly" | "annual" | "one_time";
  serviceType?: "ff" | "fs" | "fb" | "fg" | "fc" | "fd" | null;
};

export type AgreementPdfData = {
  /** Public-facing reference number ("SA-2026-042"). */
  agreementRef: string;
  status: "draft" | "sent" | "signed" | "active" | "terminated";
  territory: "fun_coast" | "space_coast" | "both" | "unassigned";
  customer: {
    companyName: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
    } | null;
  };
  preparedBy: {
    name: string;
    email?: string | null;
  };
  effectiveDate: Date;
  termStartDate: Date | null;
  termEndDate: Date | null;
  lines: AgreementPdfLine[];
  /** Customer countersignature (typed name) once they sign. Null = not signed yet. */
  customerSignedName?: string | null;
  customerSignedAt?: Date | null;
};

// ============================================================================
// STYLES — mirror QuoteDocument so the two documents feel like one suite
// ============================================================================

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#334155",
    paddingTop: 0,
    paddingBottom: 60,
    paddingHorizontal: 0,
  },
  headerBar: {
    backgroundColor: "#0066CC",
    color: "#FFFFFF",
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 36,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerBrand: {
    color: "#FFFFFF",
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
  },
  headerSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 9,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  headerRightLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  headerRightValue: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 36,
    paddingTop: 22,
  },
  pageTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    marginBottom: 4,
  },
  intro: {
    fontSize: 10,
    color: "#475569",
    lineHeight: 1.45,
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#64748B",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 6,
  },
  sectionHeading: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#0066CC",
    marginTop: 12,
    marginBottom: 4,
  },
  termHeading: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    marginTop: 8,
    marginBottom: 2,
  },
  termBody: {
    fontSize: 9.5,
    color: "#334155",
    lineHeight: 1.45,
    marginBottom: 4,
  },
  twoCol: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 6,
  },
  col: { flex: 1 },
  customerName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
  },
  customerLine: {
    fontSize: 10,
    color: "#334155",
    marginTop: 2,
  },
  // Services grid
  table: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "solid",
    borderRadius: 4,
    marginTop: 6,
  },
  thead: {
    flexDirection: "row",
    backgroundColor: "#F8FAFC",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    borderBottomStyle: "solid",
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#64748B",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    borderBottomStyle: "solid",
  },
  trLast: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  td: {
    fontSize: 10,
    color: "#334155",
  },
  // Signature blocks
  sigBlock: {
    marginTop: 18,
    flexDirection: "row",
    gap: 24,
  },
  sigCol: {
    flex: 1,
    borderTopWidth: 1,
    borderTopColor: "#0F172A",
    borderTopStyle: "solid",
    paddingTop: 6,
  },
  sigLabel: {
    fontSize: 9,
    color: "#64748B",
  },
  sigValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
    marginTop: 2,
  },
  sigDate: {
    fontSize: 9,
    color: "#64748B",
    marginTop: 2,
  },
  // FiltaGold opt-in
  optInBox: {
    marginTop: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "solid",
    borderRadius: 4,
    backgroundColor: "#F8FAFC",
  },
  optInRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  checkbox: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: "#334155",
    borderStyle: "solid",
    marginRight: 6,
  },
  // Footer
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    borderTopStyle: "solid",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    color: "#94A3B8",
  },
});

// ============================================================================
// HELPERS
// ============================================================================

const SERVICE_NAMES: Record<string, string> = {
  ff: "FiltaFry",
  fs: "FiltaClean",
  fb: "FiltaBio",
  fg: "FiltaGold",
  fc: "FiltaCool",
  fd: "FiltaDrain",
};

function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "____________________";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function frequencyLabel(f: AgreementPdfLine["frequency"]): string {
  switch (f) {
    case "per_visit":
      return "Per visit";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annual":
      return "Annual";
    case "one_time":
      return "One-time";
  }
}

function franchiseName(t: AgreementPdfData["territory"]): string {
  return t === "space_coast" ? "Filta Space Coast" : "Filta Fun Coast";
}

function franchiseAddress(t: AgreementPdfData["territory"]): string {
  return t === "space_coast"
    ? "Filta Space Coast · Brevard County, FL"
    : "Filta Fun Coast · Volusia County, FL";
}

// Per-service Scope of Service blurb. Lifted from the corporate template
// with light editing for length. Only services present in the agreement
// get printed (the customer doesn't need a description of services they
// didn't sign up for).
const SCOPE_DESCRIPTIONS: Record<string, { heading: string; interval: string; body: string }> = {
  ff: {
    heading: "FiltaFry Service",
    interval: "On a recurring schedule agreed in advance — typically weekly.",
    body:
      "FiltaFry is a mobile, on-site service combining micro-filtration of cooking oil with a thorough vacuum-based cleaning of commercial deep fryers. On each visit the technician evaluates every fryer and either filters and returns the existing oil or removes and replaces it. Solids are vacuumed; the fryer interior is cleaned with Filta's proprietary solution before service is completed.",
  },
  fb: {
    heading: "FiltaBio Service",
    interval: "Performed concurrently with FiltaFry visits.",
    body:
      "FiltaBio is a bin-free solution for the removal and recycling of used cooking oil. Used oil designated for disposal is transferred from the fryer into the FiltaBio service vehicle's onboard tank and transported to an approved recycling facility. No on-site bins or storage required.",
  },
  fg: {
    heading: "FiltaGold Service",
    interval: "Delivered as needed during FiltaFry visits.",
    body:
      "FiltaGold is Filta's oil supply service. New oil is delivered in 35-pound JIB containers from the service vehicle at the time of FiltaFry service. Pricing is at commercially reasonable market rates and is subject to weekly change. Customer may opt for FiltaGold Full (Filta supplies and manages an emergency on-site reserve) or FiltaGold Emergency Only (Filta supplies new oil only when the customer's primary supply is unavailable).",
  },
  fs: {
    heading: "FiltaClean Service",
    interval: "Performed on a schedule agreed in the service plan.",
    body:
      "FiltaClean is a professional deep cleaning service using high-temperature steam to meet sanitation requirements in commercial kitchens. Service is on-site and tailored — from individual pieces of kitchen equipment to a full kitchen-and-restaurant cleaning.",
  },
  fc: {
    heading: "FiltaCool Service",
    interval: "Replaced on a mutually agreed schedule based on unit size and usage.",
    body:
      "FiltaCool provides moisture and humidity management in commercial refrigeration units and walk-in coolers. Stainless steel holders affixed to cooler ceilings house mineral-mix packets that absorb excess humidity and ethylene gases, lowering internal temperatures, extending food shelf life, and reducing waste.",
  },
  fd: {
    heading: "FiltaDrain Service",
    interval: "Applied on a recurring schedule per the service plan.",
    body:
      "FiltaDrain is a drain maintenance service that uses a proprietary probiotic foam — composed of live, vegetative, biodegradable, non-toxic bacteria — to break down fats, oils, grease, sugars, and other organic materials that cause clogs, odors, and pest issues. No caustic chemicals, emulsifiers, or solvents.",
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ServiceAgreementDocument({
  data,
}: {
  data: AgreementPdfData;
}) {
  const showWatermark = data.status === "draft";

  // Distinct service types in this agreement — drives which scope blurbs
  // get printed in the back section.
  const distinctServices = Array.from(
    new Set(
      data.lines
        .map((l) => l.serviceType)
        .filter((s): s is "ff" | "fs" | "fb" | "fg" | "fc" | "fd" => !!s),
    ),
  );

  return (
    <Document
      title={`Filta Service Agreement — ${data.customer.companyName}`}
      author={franchiseName(data.territory)}
      subject={`Service Agreement ${data.agreementRef}`}
    >
      {/* ============================================================== */}
      {/* PAGE 1 — Cover (services grid, customer info, signatures)       */}
      {/* ============================================================== */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerBar} fixed>
          <View>
            <Text style={styles.headerBrand}>FILTA</Text>
            <Text style={styles.headerSub}>{franchiseName(data.territory)}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerRightLabel}>Service Agreement</Text>
            <Text style={styles.headerRightValue}>{data.agreementRef}</Text>
            <Text style={[styles.headerSub, { marginTop: 6 }]}>
              Effective {formatDate(data.effectiveDate)}
            </Text>
          </View>
        </View>

        {showWatermark ? (
          <Text
            style={{
              position: "absolute",
              top: 280,
              left: 90,
              fontSize: 80,
              color: "#FEE2E2",
              fontFamily: "Helvetica-Bold",
              letterSpacing: 6,
              transform: "rotate(-22deg)",
            }}
            fixed
          >
            DRAFT
          </Text>
        ) : null}

        <View style={styles.body}>
          <Text style={styles.pageTitle}>Filta Services Customer Agreement</Text>
          <Text style={styles.intro}>
            This Service Agreement is entered into as of {formatDate(data.effectiveDate)},
            by and between {data.customer.companyName} (&quot;Customer&quot;)
            and {franchiseName(data.territory)}, an independently owned and
            operated Filta franchise (&quot;Filta&quot;). This Agreement
            governs the scope, timing, and terms under which Filta will
            provide its services to the Customer.
          </Text>

          {/* Customer block */}
          <Text style={styles.sectionLabel}>Customer</Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.customerName}>{data.customer.companyName}</Text>
              {data.customer.contactName ? (
                <Text style={styles.customerLine}>
                  Billing contact: {data.customer.contactName}
                </Text>
              ) : null}
              {data.customer.contactEmail ? (
                <Text style={styles.customerLine}>
                  {data.customer.contactEmail}
                </Text>
              ) : null}
              {data.customer.contactPhone ? (
                <Text style={styles.customerLine}>
                  {data.customer.contactPhone}
                </Text>
              ) : null}
            </View>
            <View style={styles.col}>
              {data.customer.address?.line1 ? (
                <Text style={styles.customerLine}>
                  {data.customer.address.line1}
                </Text>
              ) : null}
              {data.customer.address?.line2 ? (
                <Text style={styles.customerLine}>
                  {data.customer.address.line2}
                </Text>
              ) : null}
              {(data.customer.address?.city ||
                data.customer.address?.state ||
                data.customer.address?.zip) && (
                <Text style={styles.customerLine}>
                  {[
                    data.customer.address?.city,
                    data.customer.address?.state,
                    data.customer.address?.zip,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </Text>
              )}
            </View>
          </View>

          {/* Services grid */}
          <Text style={styles.sectionLabel}>Services, frequency, and pricing</Text>
          <View style={styles.table}>
            <View style={styles.thead}>
              <View style={{ flex: 4 }}>
                <Text style={styles.th}>Service</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={styles.th}>Qty</Text>
              </View>
              <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                <Text style={styles.th}>Unit price</Text>
              </View>
              <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                <Text style={styles.th}>Frequency</Text>
              </View>
              <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                <Text style={styles.th}>Total</Text>
              </View>
            </View>
            {data.lines.map((line, idx) => {
              const last = idx === data.lines.length - 1;
              const lineTotal = line.quantity * line.unitPrice;
              const isFs = line.serviceType === "fs";
              return (
                <View key={idx} style={last ? styles.trLast : styles.tr} wrap={false}>
                  <View style={{ flex: 4 }}>
                    <Text
                      style={[
                        styles.td,
                        isFs ? { color: "#16A99B", fontFamily: "Helvetica-Bold" } : {},
                      ]}
                    >
                      {line.description}
                    </Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <Text style={styles.td}>{line.quantity}</Text>
                  </View>
                  <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                    <Text style={styles.td}>{formatCurrency(line.unitPrice)}</Text>
                  </View>
                  <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                    <Text style={[styles.td, { color: "#64748B", fontSize: 9 }]}>
                      {frequencyLabel(line.frequency)}
                    </Text>
                  </View>
                  <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                    <Text style={[styles.td, { fontFamily: "Helvetica-Bold" }]}>
                      {formatCurrency(lineTotal)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* FiltaGold opt-in (per the corporate template) */}
          {distinctServices.includes("fg") ? (
            <View style={styles.optInBox}>
              <Text style={[styles.termHeading, { marginTop: 0 }]}>
                FiltaGold Election
              </Text>
              <View style={styles.optInRow}>
                <View style={styles.checkbox} />
                <Text style={styles.termBody}>FiltaGold Full Program</Text>
              </View>
              <View style={styles.optInRow}>
                <View style={styles.checkbox} />
                <Text style={styles.termBody}>FiltaGold Emergency Only</Text>
              </View>
              <View style={styles.optInRow}>
                <View style={styles.checkbox} />
                <Text style={styles.termBody}>No FiltaGold</Text>
              </View>
            </View>
          ) : null}

          {/* QA contact (matches corporate doc) */}
          <Text style={styles.sectionLabel}>Quality Assurance Contact</Text>
          <Text style={styles.termBody}>
            From time to time Filta will contact the Customer to perform Quality
            Assurance surveys. The Customer may designate a separate QA contact
            below; if left blank, Filta will use the billing contact above.
          </Text>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.customerLine}>QA contact: ____________________________</Text>
              <Text style={styles.customerLine}>Title: __________________________________</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.customerLine}>Phone: __________________________________</Text>
              <Text style={styles.customerLine}>Email: __________________________________</Text>
            </View>
          </View>

          {/* Signatures */}
          <Text style={styles.sectionLabel}>Acceptance</Text>
          <Text style={styles.termBody}>
            By signing below, both parties acknowledge that they have read,
            understand, and agree to the foregoing Agreement and the
            accompanying Terms &amp; Conditions and Scope of Services attached.
          </Text>

          <View style={styles.sigBlock}>
            <View style={styles.sigCol}>
              <Text style={styles.sigLabel}>Customer signature</Text>
              {data.customerSignedName ? (
                <>
                  <Text style={styles.sigValue}>{data.customerSignedName}</Text>
                  {data.customerSignedAt ? (
                    <Text style={styles.sigDate}>
                      Signed {formatDate(data.customerSignedAt)}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.sigValue}>&nbsp;</Text>
                  <Text style={styles.sigDate}>Date: ________________</Text>
                </>
              )}
            </View>
            <View style={styles.sigCol}>
              <Text style={styles.sigLabel}>Filta authorized representative</Text>
              <Text style={styles.sigValue}>{data.preparedBy.name}</Text>
              <Text style={styles.sigDate}>
                {franchiseName(data.territory)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {franchiseName(data.territory)} · Independently owned and operated
            Filta franchise
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>

      {/* ============================================================== */}
      {/* PAGES 2-3 — Terms & Conditions                                  */}
      {/* ============================================================== */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerBar} fixed>
          <View>
            <Text style={styles.headerBrand}>FILTA</Text>
            <Text style={styles.headerSub}>{franchiseName(data.territory)}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerRightLabel}>Service Agreement</Text>
            <Text style={styles.headerRightValue}>{data.agreementRef}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.pageTitle}>Terms &amp; Conditions</Text>

          <Text style={styles.termHeading}>General</Text>
          <Text style={styles.termBody}>
            Filta shall furnish all supervision, labor, materials, supplies, and
            equipment required to provide the services to Customer&apos;s
            facility. The scope is limited to the services listed on the cover
            page; additional services may be added in writing by both parties.
            Customer acknowledges that each Filta location is an independently
            owned and operated franchise of the Filta Group, Inc.; Filta Group,
            Inc. is not bound by this Agreement.
          </Text>

          <Text style={styles.termHeading}>National Account Exception</Text>
          <Text style={styles.termBody}>
            If Customer is identified by Filta Group as a National Centralized
            Customer (&quot;NCA&quot;) operating under a separate national
            agreement, that agreement shall take precedence over this
            location-specific agreement.
          </Text>

          <Text style={styles.termHeading}>Term &amp; Termination</Text>
          <Text style={styles.termBody}>
            This Agreement is for an initial term of three (3) years
            commencing on the Effective Date and will automatically renew for
            additional consecutive three-year terms. Either party may
            terminate, with or without cause, on thirty (30) days&apos;
            written notice.
          </Text>

          <Text style={styles.termHeading}>Opportunity to Cure</Text>
          <Text style={styles.termBody}>
            If Customer identifies a problem in the performance of services,
            Customer shall provide Filta with written notice. Filta will have
            thirty (30) days to address and resolve the issue. Termination by
            Customer without notice and opportunity to cure may entitle Filta
            to damages limited to the lesser of (i) total monthly value of
            services × months remaining in the current term, or (ii) three
            times the annual service value.
          </Text>

          <Text style={styles.termHeading}>Indemnity</Text>
          <Text style={styles.termBody}>
            Customer warrants that fryers and other equipment serviced are in
            good working order. Filta is not responsible for damage caused by
            neglect, lack of maintenance, acts of God, or misuse. Each party
            shall indemnify the other against claims arising from its own
            negligence.
          </Text>

          <Text style={styles.termHeading}>Pricing &amp; Late Fees</Text>
          <Text style={styles.termBody}>
            On written notice, Filta may increase service pricing once per
            calendar year by a maximum of five percent (5%). Payment terms
            are Net 7 from invoice date unless an NCA agreement specifies
            otherwise. A $25 late fee may be charged on payments more than
            fifteen (15) days past due. Filta may suspend service on
            invoices unpaid after forty-five (45) days and charge interest up
            to the state maximum.
          </Text>

          <Text style={styles.termHeading}>Disputes</Text>
          <Text style={styles.termBody}>
            This Agreement shall be governed by the laws of the State of New
            Jersey. The prevailing party in any action to enforce or declare
            rights under this Agreement is entitled to reasonable attorneys&apos;
            fees, costs, and expenses, including pre-suit mediation costs.
          </Text>

          <Text style={styles.termHeading}>Confidentiality</Text>
          <Text style={styles.termBody}>
            During the term of this Agreement and for five (5) years after
            its termination, Customer agrees not to disclose the terms of
            this Agreement to any third party.
          </Text>

          <Text style={styles.termHeading}>Miscellaneous</Text>
          <Text style={styles.termBody}>
            Neither party is required to perform if performance becomes
            commercially impracticable due to a force majeure event. If any
            provision is held invalid, the remaining provisions stay in
            force. This Agreement is the final agreement between the
            parties; modifications must be in writing and signed by both.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {franchiseName(data.territory)} · Independently owned and operated
            Filta franchise
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>

      {/* ============================================================== */}
      {/* PAGE 3+ — Scope of Service per active service                    */}
      {/* ============================================================== */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerBar} fixed>
          <View>
            <Text style={styles.headerBrand}>FILTA</Text>
            <Text style={styles.headerSub}>{franchiseName(data.territory)}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerRightLabel}>Service Agreement</Text>
            <Text style={styles.headerRightValue}>{data.agreementRef}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.pageTitle}>Scope of Services</Text>
          <Text style={styles.intro}>
            The descriptions below cover the services included in this
            Agreement. Service intervals and procedures may be adjusted in
            writing by mutual agreement.
          </Text>

          {distinctServices.length === 0 ? (
            <Text style={styles.termBody}>
              No services with a recognized service type are included in this
              Agreement.
            </Text>
          ) : (
            distinctServices.map((s) => {
              const desc = SCOPE_DESCRIPTIONS[s];
              if (!desc) return null;
              return (
                <View key={s} wrap={false}>
                  <Text style={styles.sectionHeading}>
                    {desc.heading}
                  </Text>
                  <Text style={styles.termBody}>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>
                      Service interval —{" "}
                    </Text>
                    {desc.interval}
                  </Text>
                  <Text style={styles.termBody}>{desc.body}</Text>
                </View>
              );
            })
          )}

          <Text style={[styles.termBody, { marginTop: 18, color: "#64748B" }]}>
            Term: initial three (3) years from {formatDate(data.termStartDate)}{" "}
            through {formatDate(data.termEndDate)}, automatically renewing for
            additional three-year terms unless terminated per the Term &amp;
            Termination clause above.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {franchiseName(data.territory)} · Independently owned and operated
            Filta franchise
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

// ============================================================================
// SERVER-SIDE BUFFER HELPER
// ============================================================================

export async function renderServiceAgreementPdf(
  data: AgreementPdfData,
): Promise<Buffer> {
  return renderToBuffer(<ServiceAgreementDocument data={data} />);
}
