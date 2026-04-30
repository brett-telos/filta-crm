// Branded PDF quote — modeled on the corporate Filta Service Agreement
// (docs/reference/CorporateFiltaServiceAgreement.docx) but positioned as a
// proposal: services × frequency × pricing × opt-in, totals, validity,
// and a "Standard terms" footer summarizing what'll be in the actual
// Service Agreement at signing time. Full T&Cs deferred — the customer
// signs the corporate agreement when they accept the quote.
//
// Renders via @react-pdf/renderer (server-side). The same component is
// used for inline preview and email-attachment generation; one source of
// truth keeps the email and the download identical.
//
// Color palette:
//   filta-blue       #0066CC  primary brand
//   filta-blue-dark  #004A99  header bar background
//   slate-700        #334155  body text
//   slate-500        #64748B  muted body
//   slate-200        #E2E8F0  borders
//   service-fs       #16A99B  FiltaClean teal — used as accent on FS lines
//
// All values are inline because @react-pdf/renderer doesn't support
// stylesheets the way browser CSS does.

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

export type QuotePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  frequency: "per_visit" | "monthly" | "quarterly" | "annual" | "one_time";
  /** Used to tint FS rows with the service-fs accent. */
  serviceType?: "ff" | "fs" | "fb" | "fg" | "fc" | "fd" | null;
};

export type QuotePdfData = {
  /** Quote identifier shown to the customer ("Q-2026-042-v2"). */
  quoteRef: string;
  /** Status for the watermark — only 'sent' / 'accepted' get printed. */
  status?: "draft" | "sent" | "accepted" | "declined" | "expired";
  /** Filta franchise sending the quote — drives header copy + sender block. */
  territory: "fun_coast" | "space_coast" | "both" | "unassigned";
  customer: {
    companyName: string;
    contactName?: string | null;
    contactEmail?: string | null;
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
  preparedAt: Date;
  validUntil: Date | null;
  lines: QuotePdfLine[];
  totals: {
    subtotalMonthly: number;
    subtotalQuarterly: number;
    subtotalOneTime: number;
    estimatedAnnual: number;
  };
  notes?: string | null;
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#334155",
    paddingTop: 0,
    paddingBottom: 50,
    paddingHorizontal: 0,
  },
  // Top filta-blue bar — same brand moment as the email header.
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
  // Body shell
  body: {
    paddingHorizontal: 36,
    paddingTop: 24,
  },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#64748B",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  twoCol: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 18,
  },
  col: { flex: 1 },
  customerName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#0F172A",
  },
  customerLine: {
    fontSize: 10,
    color: "#334155",
    marginTop: 2,
  },
  // Service grid
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
  // Totals block
  totalsBox: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  totalsTable: {
    width: "55%",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalsLabel: {
    fontSize: 10,
    color: "#475569",
  },
  totalsValue: {
    fontSize: 10,
    color: "#0F172A",
    fontFamily: "Helvetica-Bold",
  },
  totalsHeadline: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    borderTopStyle: "solid",
  },
  totalsHeadlineLabel: {
    fontSize: 11,
    color: "#0F172A",
    fontFamily: "Helvetica-Bold",
  },
  totalsHeadlineValue: {
    fontSize: 14,
    color: "#0066CC",
    fontFamily: "Helvetica-Bold",
  },
  // Notes
  notesBox: {
    marginTop: 18,
    padding: 12,
    backgroundColor: "#F8FAFC",
    borderLeftWidth: 3,
    borderLeftColor: "#0066CC",
    borderLeftStyle: "solid",
  },
  notesText: {
    fontSize: 10,
    color: "#334155",
    lineHeight: 1.4,
  },
  // CTA
  cta: {
    marginTop: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: "#0066CC",
    borderStyle: "solid",
    borderRadius: 4,
    backgroundColor: "#EFF6FF",
  },
  ctaTitle: {
    fontSize: 12,
    color: "#0066CC",
    fontFamily: "Helvetica-Bold",
  },
  ctaBody: {
    fontSize: 10,
    color: "#334155",
    marginTop: 4,
    lineHeight: 1.4,
  },
  // Standard terms summary
  termsBox: {
    marginTop: 22,
  },
  termsItem: {
    fontSize: 9,
    color: "#475569",
    marginTop: 3,
    lineHeight: 1.35,
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

function formatCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function frequencyLabel(f: QuotePdfLine["frequency"]): string {
  switch (f) {
    case "per_visit":
      return "per visit";
    case "monthly":
      return "monthly";
    case "quarterly":
      return "quarterly";
    case "annual":
      return "annual";
    case "one_time":
      return "one-time";
  }
}

function franchiseName(t: QuotePdfData["territory"]): string {
  return t === "space_coast" ? "Filta Space Coast" : "Filta Fun Coast";
}

function franchiseAddress(t: QuotePdfData["territory"]): string {
  // Pulled from Brett's franchise locations — placeholder until confirmed.
  return t === "space_coast"
    ? "Filta Space Coast · Brevard County, FL"
    : "Filta Fun Coast · Volusia County, FL";
}

// ============================================================================
// COMPONENT
// ============================================================================

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const showWatermark = data.status === "draft";

  return (
    <Document
      title={`Filta Quote — ${data.customer.companyName}`}
      author={franchiseName(data.territory)}
      subject={`Quote ${data.quoteRef}`}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header bar */}
        <View style={styles.headerBar} fixed>
          <View>
            <Text style={styles.headerBrand}>FILTA</Text>
            <Text style={styles.headerSub}>{franchiseName(data.territory)}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerRightLabel}>Quote</Text>
            <Text style={styles.headerRightValue}>{data.quoteRef}</Text>
            <Text style={[styles.headerSub, { marginTop: 6 }]}>
              {formatDate(data.preparedAt)}
            </Text>
          </View>
        </View>

        {/* DRAFT watermark — only on draft status */}
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
          {/* Customer + sender block */}
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.sectionLabel}>Prepared for</Text>
              <Text style={styles.customerName}>
                {data.customer.companyName}
              </Text>
              {data.customer.contactName ? (
                <Text style={styles.customerLine}>
                  {data.customer.contactName}
                </Text>
              ) : null}
              {data.customer.contactEmail ? (
                <Text style={styles.customerLine}>
                  {data.customer.contactEmail}
                </Text>
              ) : null}
              {data.customer.address ? (
                <>
                  {data.customer.address.line1 ? (
                    <Text style={styles.customerLine}>
                      {data.customer.address.line1}
                    </Text>
                  ) : null}
                  {data.customer.address.line2 ? (
                    <Text style={styles.customerLine}>
                      {data.customer.address.line2}
                    </Text>
                  ) : null}
                  {(data.customer.address.city ||
                    data.customer.address.state ||
                    data.customer.address.zip) && (
                    <Text style={styles.customerLine}>
                      {[
                        data.customer.address.city,
                        data.customer.address.state,
                        data.customer.address.zip,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                  )}
                </>
              ) : null}
            </View>

            <View style={styles.col}>
              <Text style={styles.sectionLabel}>Prepared by</Text>
              <Text style={styles.customerName}>
                {franchiseName(data.territory)}
              </Text>
              <Text style={styles.customerLine}>{data.preparedBy.name}</Text>
              {data.preparedBy.email ? (
                <Text style={styles.customerLine}>{data.preparedBy.email}</Text>
              ) : null}
              <Text style={styles.customerLine}>
                {franchiseAddress(data.territory)}
              </Text>
              {data.validUntil ? (
                <Text
                  style={[
                    styles.customerLine,
                    { marginTop: 10, color: "#0066CC" },
                  ]}
                >
                  Valid until {formatDate(data.validUntil)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Services × Frequency × Pricing × Opt-in grid */}
          <Text style={styles.sectionLabel}>Proposed services</Text>
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

            {data.lines.length === 0 ? (
              <View style={styles.trLast}>
                <Text
                  style={[
                    styles.td,
                    { flex: 1, textAlign: "center", color: "#94A3B8" },
                  ]}
                >
                  No line items yet.
                </Text>
              </View>
            ) : (
              data.lines.map((line, idx) => {
                const last = idx === data.lines.length - 1;
                const lineTotal = line.quantity * line.unitPrice;
                const isFs = line.serviceType === "fs";
                return (
                  <View
                    key={idx}
                    style={last ? styles.trLast : styles.tr}
                    wrap={false}
                  >
                    <View style={{ flex: 4 }}>
                      <Text
                        style={[
                          styles.td,
                          isFs
                            ? { color: "#16A99B", fontFamily: "Helvetica-Bold" }
                            : {},
                        ]}
                      >
                        {line.description}
                      </Text>
                    </View>
                    <View style={{ flex: 1, alignItems: "center" }}>
                      <Text style={styles.td}>{line.quantity}</Text>
                    </View>
                    <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                      <Text style={styles.td}>
                        {formatCurrency(line.unitPrice)}
                      </Text>
                    </View>
                    <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                      <Text
                        style={[styles.td, { color: "#64748B", fontSize: 9 }]}
                      >
                        {frequencyLabel(line.frequency)}
                      </Text>
                    </View>
                    <View style={{ flex: 1.5, alignItems: "flex-end" }}>
                      <Text
                        style={[styles.td, { fontFamily: "Helvetica-Bold" }]}
                      >
                        {formatCurrency(lineTotal)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Totals */}
          <View style={styles.totalsBox}>
            <View style={styles.totalsTable}>
              {data.totals.subtotalMonthly > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Monthly recurring</Text>
                  <Text style={styles.totalsValue}>
                    {formatCurrency(data.totals.subtotalMonthly)}
                  </Text>
                </View>
              ) : null}
              {data.totals.subtotalQuarterly > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Quarterly recurring</Text>
                  <Text style={styles.totalsValue}>
                    {formatCurrency(data.totals.subtotalQuarterly)}
                  </Text>
                </View>
              ) : null}
              {data.totals.subtotalOneTime > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>One-time charges</Text>
                  <Text style={styles.totalsValue}>
                    {formatCurrency(data.totals.subtotalOneTime)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.totalsHeadline}>
                <Text style={styles.totalsHeadlineLabel}>
                  Estimated annual value
                </Text>
                <Text style={styles.totalsHeadlineValue}>
                  {formatCurrency(data.totals.estimatedAnnual)}
                </Text>
              </View>
            </View>
          </View>

          {/* Optional notes from rep */}
          {data.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{data.notes}</Text>
            </View>
          ) : null}

          {/* Soft-accept CTA */}
          <View style={styles.cta}>
            <Text style={styles.ctaTitle}>Ready to move forward?</Text>
            <Text style={styles.ctaBody}>
              Reply to this email or call {data.preparedBy.name} at{" "}
              {franchiseName(data.territory)} to confirm. We&apos;ll send the
              full Service Agreement for signature and schedule the first visit
              within a week of acceptance.
            </Text>
          </View>

          {/* Standard terms summary */}
          <View style={styles.termsBox} wrap={false}>
            <Text style={styles.sectionLabel}>Standard terms</Text>
            <Text style={styles.termsItem}>
              • Service Agreement runs for an initial three (3) year term and
              auto-renews for additional three-year periods. Either party may
              terminate with 30 days&apos; written notice.
            </Text>
            <Text style={styles.termsItem}>
              • Payment terms are Net 7 from invoice date (NCA agreements may
              specify alternate terms). Late fees of $25 apply after 15 days
              past due; service may be suspended if unpaid after 45 days.
            </Text>
            <Text style={styles.termsItem}>
              • Pricing may increase by up to 5% per calendar year on written
              notice. Pricing in this quote is held until the validity date
              shown above.
            </Text>
            <Text style={styles.termsItem}>
              • Filta is responsible for the licensing, insurance, and crew
              required to perform the services listed; the customer provides
              reasonable site access during agreed service windows.
            </Text>
            <Text style={[styles.termsItem, { marginTop: 6, color: "#64748B" }]}>
              Full terms and conditions are included in the Service Agreement
              provided at signing.
            </Text>
          </View>
        </View>

        {/* Footer */}
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

/**
 * Render the QuoteDocument to a PDF buffer. Both the email-attachment path
 * and the download endpoint call this; one render → one source of truth.
 *
 * Returns Buffer so the caller can stream it (NextResponse) or base64-encode
 * it for Resend's attachment payload.
 */
export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument data={data} />);
}
