import type { MetadataRoute } from "next";

// No sitemap.xml here yet — a sitemap needs absolute URLs, which need a real
// production domain (see layout.tsx's NEXT_PUBLIC_APP_URL comment). robots
// rules don't have that dependency, so there's no reason to wait on those
// together.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/settings", "/subscriptions"],
    },
  };
}
