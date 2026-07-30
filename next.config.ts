import type { NextConfig } from "next";

// Baseline security headers only — a real Content-Security-Policy needs
// nonce-based script-src to work with Next's inline hydration scripts
// without a blanket 'unsafe-inline', which is a bigger, riskier change than
// belongs in a quick pass. Deferred to a dedicated hardening review.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
