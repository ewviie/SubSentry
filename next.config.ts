import type { NextConfig } from "next";

// Baseline security headers applied to every response. The
// Content-Security-Policy itself (nonce-based, strict-dynamic) is set
// per-request in src/proxy.ts instead of here — it needs a fresh nonce on
// every request, which a static headers() array can't generate.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 180 days, no `preload` — HSTS preload lists are effectively permanent
  // (removal takes months and isn't guaranteed), too big a commitment for
  // an app without a fixed production domain yet (see layout.tsx's
  // NEXT_PUBLIC_APP_URL comment). A browser only honors this header over
  // an HTTPS response in the first place, so it's inert in local dev.
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
];

// Every /api/* route in this app either requires a session (reads cookies,
// which already makes Next.js render it dynamically — confirmed in the
// build output, all show as ƒ Dynamic, never ○ Static) or is the Stripe
// webhook (never meant to be cached either way). Explicit no-store is
// defense-in-depth, not a behavior change: it protects against a
// misconfigured CDN/reverse proxy in front of the app that might cache
// based on some other signal, and against a browser's back/forward cache
// serving a stale authenticated response after logout.
const noStoreApiHeaders = [{ key: "Cache-Control", value: "no-store" }];

const nextConfig: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: noStoreApiHeaders },
    ];
  },
};

export default nextConfig;
