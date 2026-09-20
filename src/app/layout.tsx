import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
/*
 * Phosphor Regular, the product's one icon set, imported from the package rather
 * than the CDN the design sketched it against: a household gateway should not make
 * a browser reach a third party to draw its own navigation, and next/font gives the
 * two text families the same treatment. `Icon` is the only component that may name
 * a glyph — see `src/components/ui/Icon.tsx`.
 */
import "@phosphor-icons/web/regular";

/*
 * Inter carries every UI size and JetBrains Mono the machine column. next/font
 * downloads both at build time and serves them from this deployment, so a Pi with
 * no route to Google Fonts still renders the product as designed. The variables
 * named here are what --ff-font, --ff-font-display and --ff-font-mono resolve to.
 */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--ff-font-inter" });
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--ff-font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "FamilyFi",
  description: "Family internet controls for a UniFi gateway",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/app-icon.png", apple: "/brand/app-icon.png" },
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
    <html lang="en" className={`${inter.variable} ${jetBrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
