import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { SentryRing } from "@/components/ui/sentry-ring";

// A lighter header for standalone content/tool pages (not the homepage
// scroll-tracking LandingNav, whose Features/Pricing/FAQ links are same-page
// anchors that only resolve on "/" — reusing that nav here would ship 3
// broken links). Same logo/type treatment, no scroll listener: one less
// client-side behavior on pages this SEO pass is trying to keep lightweight.
export function MarketingNav() {
  return (
    <header className="border-b border-border/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
          <span aria-hidden="true" className="relative flex size-8 items-center justify-center">
            <SentryRing />
            <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-full rounded-full object-cover" />
          </span>
          SubSentry
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" render={<Link href="/login" />} nativeButton={false}>
            Log in
          </Button>
          <Button render={<Link href="/signup" />} nativeButton={false}>
            Start free
          </Button>
        </div>
      </div>
    </header>
  );
}
