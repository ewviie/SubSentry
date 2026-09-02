import type { Metadata } from "next";
import "./globals.css";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MotionConfig } from "framer-motion";
import { absoluteUrl, getAppUrl } from "@/lib/seo";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

// No production domain is configured anywhere in this project yet, so this
// is deliberately read from an env var rather than a hardcoded guess. Left
// unset, Next silently falls back to resolving og:image/twitter:image
// against "http://localhost:3000" in production builds. A broken share
// preview is worse than an honest build-time warning, so this is not
// papered over with a fabricated domain. Set NEXT_PUBLIC_APP_URL once a
// real domain exists.
const SITE_TITLE = "SubSentry";
// ASO/SEO pass: outcome-first, not mechanism-first — this is the fallback
// every page without its own metadata inherits (every auth page sets its
// own; this is what a future page that forgets to would show). "AI-powered
// subscription management" led with the mechanism (AI) over what a visitor
// actually gets; leads with tracking + the realized-savings proof point now
// instead, matching the homepage's own real copy rather than describing the
// product differently in the one place most likely to go stale.
const SITE_DESCRIPTION = "Track your subscriptions and see what you've actually saved.";

// generateMetadata (a function), not a static `export const metadata`
// object: metadataBase needs process.env.NEXT_PUBLIC_APP_URL read fresh
// per render, not once at module-import time. Verified empirically
// (against a real production build) that a module-scope read of that env
// var produces `undefined` for metadataBase on every dynamically-rendered
// page (/, /login, /signup, /forgot-password, /subscription-tracker,
// anything that calls getSession(), which makes it dynamic), even with the
// var genuinely set for the running process. See lib/seo.ts's own comment
// for the fuller story and why absoluteUrl() below has the same
// read-inside-the-function shape.
export async function generateMetadata(): Promise<Metadata> {
  return {
    // title.template applies to every page under this layout that sets its
    // own `title` (e.g. login/signup) without repeating "SubSentry".
    // `default` is what renders on pages (like the landing page) that
    // don't override title at all.
    title: { default: SITE_TITLE, template: `%s | ${SITE_TITLE}` },
    description: SITE_DESCRIPTION,
    // getAppUrl() (not a raw `new URL(process.env.NEXT_PUBLIC_APP_URL)`):
    // a malformed value is treated as unset instead of throwing here and
    // crashing metadata generation for every page; see lib/seo.ts's own
    // comment.
    metadataBase: (() => {
      const appUrl = getAppUrl();
      return appUrl ? new URL(appUrl) : undefined;
    })(),
    // Explicit absolute URLs via absoluteUrl(), not left as bare relative
    // strings for metadataBase to resolve. This is the fallback every
    // page that doesn't set its own canonical/openGraph inherits.
    alternates: { canonical: absoluteUrl("/") ?? "/" },
    openGraph: {
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
      type: "website",
    },
    twitter: {
      card: "summary",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Set by proxy.ts on every request. next-themes injects an inline
  // (nonce-less by default) <script> before hydration to apply the
  // system/stored theme class without a flash of the wrong theme. Under
  // this app's strict nonce-based CSP (no 'unsafe-inline' in script-src),
  // that script silently fails CSP and never runs without this, so the
  // theme class is never applied at all, on every page, regardless of
  // system preference or a stored choice. Same pattern (auth)/layout.tsx
  // already uses for the Turnstile widget's own nonce need.
  const nonce = (await headers()).get("x-nonce");

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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce ?? undefined}>
          <TooltipProvider>
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
