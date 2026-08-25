import Link from "next/link";
import Image from "next/image";

// Where the 3 SEO pages actually live in the nav hierarchy: not the primary
// header (those anchors are homepage-only sections, these are separate
// routes), but a real, crawlable, site-wide link, one click from every
// page, including the homepage. That's "reachable in a small number of
// clicks," not "buried," without competing with Features/Pricing/FAQ for
// primary-nav space.
const RESOURCE_LINKS = [
  { href: "/subscription-tracker", label: "Subscription tracker" },
  { href: "/guides/how-to-find-forgotten-subscriptions", label: "Find forgotten subscriptions" },
  { href: "/subscription-cost-calculator", label: "Cost calculator" },
] as const;

export function LandingFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Image src="/logo-mark.png" alt="" width={20} height={20} className="size-5 rounded-full object-cover" aria-hidden="true" />
            SubSentry
          </span>
          <nav aria-label="Resources" className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-6">
            {RESOURCE_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-foreground hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="Footer" className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">Log in</Link>
            <Link href="/signup" className="hover:text-foreground">Sign up</Link>
          </nav>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} SubSentry. All rights reserved.</p>
          <nav aria-label="Legal" className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground hover:underline">Terms of Service</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
