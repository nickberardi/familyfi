import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FamilyFi",
  description: "Family internet controls for a UniFi gateway",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FamilyFi" },
};

// The browser reads theme-color from a meta tag before CSS applies, so this one
// cannot be a token. Keep it equal to --ff-page.
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
