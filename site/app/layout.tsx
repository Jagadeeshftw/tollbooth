import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ThemeProvider } from "@/context/theme-provider";
import { inter } from "@/fonts/inter-display/inter";
import { dmMono } from "@/fonts/dm-mono";
import { REPO } from "@/content/measurements";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tollbooth.0xo.in";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Tollbooth — a paywall layer for MCP servers",
  description:
    "In 71 blind trials, agents came back after a payment challenge 95–100% of the time with structured and text challenges, and 0% with URL elicitation. Tollbooth is the measured way to charge for MCP tools.",
  openGraph: {
    title: "Tollbooth — agents come back after a payment challenge. We measured it.",
    description:
      "71 blind trials. 95–100% retry with structured and text challenges, 0% with elicitation.",
    url: SITE,
    siteName: "Tollbooth",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Tollbooth — a paywall layer for MCP servers. 18/18, 41/43, 0/10.",
      },
    ],
  },
  twitter: {
    // summary_large_image, not summary: this link is meant to be pasted into
    // Discord, Telegram and X, where the large card is the one people read.
    card: "summary_large_image",
    title: "Tollbooth — a paywall layer for MCP servers",
    description: "71 blind trials. 95–100% retry with structured and text challenges, 0% with elicitation.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  alternates: { canonical: SITE },
  other: { "x-repo": REPO },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${dmMono.variable}`}>
      <body className="font-primary h-full bg-white [--pattern-fg:var(--color-charcoal-900)]/10 dark:bg-black dark:[--pattern-fg:var(--color-neutral-100)]/30">
        <ThemeProvider attribute="class" defaultTheme="system">
          <main className="h-full bg-white antialiased dark:bg-black">
            <Navbar />
            {children}
            <Footer />
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
