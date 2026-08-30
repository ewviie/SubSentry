import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/utils";
import { isDevPlanPreviewAvailable, getDevPlanPreview } from "@/lib/dev/plan-preview";
import { DevPlanPreviewBanner } from "@/components/dev/dev-plan-preview-banner";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { CheckoutActivator } from "@/components/billing/checkout-activator";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { HeaderQuickActions } from "@/components/app-shell/header-quick-actions";
import { PageTransition } from "@/components/app-shell/page-transition";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

// robots.ts's disallow list only stops a well-behaved crawler from
// *fetching* these pages. It doesn't stop a URL from getting indexed with
// no content if it's ever linked from somewhere Google can see (a disallowed
// page can't be crawled to discover a noindex tag on it, but Google can still
// index the bare URL). None of these ~8 routes has any real content for a
// crawler that never authenticates anyway (requireUser() redirects it to
// /login), so noindex here is a correct, honest signal, not one this app
// needs a page-by-page opt-out from: every route under this layout is
// private by construction.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Rendered on every authenticated page, not just Settings — the whole
  // point is to see the Free/Pro distinction show up everywhere it's
  // supposed to (dashboard, subscriptions, savings), not only on the one
  // page that names the plan. Never rendered at all when unavailable
  // (checked server-side, before the component or its JS is even part of
  // the tree) — see lib/dev/plan-preview.ts's own comment on why that's a
  // hard guarantee, not a cosmetic hide.
  const devPreviewAvailable = isDevPlanPreviewAvailable();
  const devPlanPreview = devPreviewAvailable ? await getDevPlanPreview() : null;

  return (
    <div className="min-h-svh bg-background">
      {devPreviewAvailable ? <DevPlanPreviewBanner current={devPlanPreview} /> : null}
      <Suspense fallback={null}>
        <CheckoutActivator />
      </Suspense>
      <SidebarNav />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2 lg:hidden">
              <MobileNav />
              <Link href="/dashboard" className="flex items-center gap-2 font-heading text-base font-semibold">
                <Image src="/logo-mark.png" alt="" width={24} height={24} className="size-6 rounded-full object-cover" />
                SubSentry
              </Link>
            </div>
            <div className="ml-auto flex items-center gap-3 sm:gap-2">
              <HeaderQuickActions />
              <Link
                href="/settings"
                aria-label={`Account: ${user.email}`}
                className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-emerald-muted text-emerald">
                    {initials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline">{user.email}</span>
              </Link>
              <Separator orientation="vertical" className="hidden h-5 sm:block" />
              <LogoutButton />
            </div>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
