import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { getAppUrl } from "@/lib/seo";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

// Visual trail + the JSON-LD it represents kept in one component so they
// can't drift apart, same principle as page.tsx's FAQPage schema being
// built from the same FAQS array the accordion renders.
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  // schema.org wants absolute URLs in `item`, same NEXT_PUBLIC_APP_URL gate
  // every other absolute-URL field in this app already uses (metadataBase,
  // sitemap.ts, robots.ts, the SoftwareApplication `url` field). Omitted
  // entirely rather than resolved against localhost when unset.
  //
  // getAppUrl(), not a raw process.env read: a malformed (but non-empty)
  // NEXT_PUBLIC_APP_URL would otherwise reach `new URL(item.href, appUrl)`
  // below unvalidated and throw, crashing every page that renders
  // breadcrumbs. getAppUrl() already treats malformed the same as unset;
  // see its own comment in lib/seo.ts.
  const appUrl = getAppUrl();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href && appUrl ? { item: new URL(item.href, appUrl).toString() } : {}),
    })),
  };

  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-6xl px-4 py-4 text-sm text-muted-foreground sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            {item.href ? (
              // Caller-supplied, not a literal here, same escape hatch
              // import-center-page.tsx already uses for this exact
              // typedRoutes limitation (a route string built/passed at
              // runtime rather than written as a literal at the call site).
              <Link href={item.href as Route} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
