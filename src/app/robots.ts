import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const appUrl = getAppUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /savings, /analytics, and /notifications were missing here — all
      // three are requireUser()-gated the same as /dashboard and /settings
      // (every route under the (app) route group is — see that layout's own
      // requireUser() call), so leaving any of them off this list was an
      // inconsistency, not a deliberate choice: nothing distinguishes them
      // from the routes that were already blocked. requireUser() is the
      // real security boundary regardless (it redirects an unauthenticated
      // crawler to /login before any content renders) — this list is a
      // politeness signal on top of that, not what indexability actually
      // depends on.
      disallow: ["/api/", "/dashboard", "/settings", "/subscriptions", "/savings", "/analytics", "/notifications"],
    },
    // sitemap.xml needs an absolute URL, same NEXT_PUBLIC_APP_URL gate as
    // sitemap.ts itself — pointing crawlers at a sitemap built from
    // localhost would be worse than omitting the pointer, so this only
    // appears once a real domain is configured. A crawler can still find
    // and index every allowed page without this (that's what the `allow`
    // rule and real internal links are for) — this is a discovery
    // shortcut, not something indexability depends on.
    ...(appUrl ? { sitemap: new URL("/sitemap.xml", appUrl).toString() } : {}),
  };
}
