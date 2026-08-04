import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/utils";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { CheckoutActivator } from "@/components/billing/checkout-activator";
import { NavLink } from "@/components/app-shell/nav-link";
import { PageTransition } from "@/components/app-shell/page-transition";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-svh bg-background">
      <Suspense fallback={null}>
        <CheckoutActivator />
      </Suspense>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
            <Image src="/logo-mark.png" alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
            SubSentry
          </Link>
          <div className="flex items-center gap-3 sm:gap-4">
            <nav aria-label="Primary" className="hidden items-center gap-3 sm:flex sm:gap-4">
              <NavLink href="/analytics">Analytics</NavLink>
              <NavLink href="/savings">Savings</NavLink>
            </nav>
            <nav aria-label="Account" className="flex items-center gap-3 sm:gap-4">
              <NavLink href="/settings">Settings</NavLink>
              <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
              <Link
                href="/settings"
                aria-label={`Account: ${user.email}`}
                className="sm:hidden"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-gold-muted text-gold">
                    {initials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
              </Link>
            </nav>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
