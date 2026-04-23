import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Filta CRM",
  description: "Sales CRM for Filta Fun Coast & Filta Space Coast",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
