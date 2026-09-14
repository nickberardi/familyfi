import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FamilyFi",
  description: "Family internet controls for a UniFi gateway",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FamilyFi" },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
