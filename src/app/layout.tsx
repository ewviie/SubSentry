import type { Metadata } from "next";
import "./globals.css";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionConfig } from "framer-motion";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

// No production domain is configured anywhere in this project yet, so this
// is deliberately read from an env var rather than a hardcoded guess. Left
// unset, Next silently falls back to resolving og:image/twitter:image
// against "http://localhost:3000" in production builds — a broken share
// preview is worse than an honest build-time warning, so this is not
// papered over with a fabricated domain. Set NEXT_PUBLIC_APP_URL once a
// real domain exists.
const SITE_TITLE = "SubSentry";
const SITE_DESCRIPTION = "AI-powered subscription management";
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: appUrl ? new URL(appUrl) : undefined,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/logo-mark.png"],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/logo-mark.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans",
        geist.variable,
        geistMono.variable,
        spaceGrotesk.variable,
      )}
    >
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-elevation-medium focus:ring-3 focus:ring-ring/50 focus:outline-none"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
