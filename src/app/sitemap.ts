import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/seo";

// Sitemap entries need absolute URLs — same NEXT_PUBLIC_APP_URL dependency
// robots.ts's own comment already documents. Rather than wait on that (the
// way robots.ts chose to), or fabricate a fake domain to fill the URLs in
// with, this returns a valid-but-empty sitemap until a real, validly-formed
// domain is set (getAppUrl() treats malformed the same as unset — see its
// own comment): an empty <urlset/> is a technically correct, honest answer
// ("no crawlable pages known yet"), and /sitemap.xml serves 200 instead of
// 404 either way.
// Update this list if new public marketing routes are added — only
// (session-gated dashboard etc. is already excluded from crawling via
// robots.ts's disallow list, so it has no reason to appear here either).
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/subscription-tracker",
  "/guides/how-to-find-forgotten-subscriptions",
  "/subscription-cost-calculator",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = getAppUrl();
  if (!appUrl) return [];

  const now = new Date();
  return PUBLIC_ROUTES.map((path) => ({
    url: new URL(path, appUrl).toString(),
    lastModified: now,
  }));
}
