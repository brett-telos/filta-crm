import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Brand guideline names Proxima Nova as the primary face. That's Adobe Fonts
// only (paid), so we ship Inter as the open-source stand-in — same geometric
// sans feel, near-identical metrics. If/when the franchise licenses Proxima
// Nova, swap the import line here; the CSS variable (`--font-sans`) stays the
// same so no Tailwind class changes are needed downstream.
const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Filta CRM",
  description: "Sales CRM for Filta Fun Coast & Filta Space Coast",
  // Mobile-first — the field reps will hit this from the truck on a phone.
  applicationName: "Filta CRM",
  formatDetection: {
    telephone: true, // auto-linkify phone numbers in Safari
  },
  icons: {
    icon: "/brand/filta-glyph.svg",
    shortcut: "/brand/filta-glyph.svg",
    apple: "/brand/filta-glyph.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#1595C8", // Filta Blue — matches address bar + splash on iOS
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
