import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const appUrl = getAppUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /savings and /analytics were missing here — both are requireUser()-gated
      // the same as /dashboard and /settings, so leaving them off this list was
      // an inconsistency, not a deliberate choice: nothing distinguishes them
      // from the routes that were already blocked.
      disallow: ["/api/", "/dashboard", "/settings", "/subscriptions", "/savings", "/analytics"],
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
