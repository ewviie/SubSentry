import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/utils";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { CheckoutActivator } from "@/components/billing/checkout-activator";
import { PrimaryNav } from "@/components/app-shell/primary-nav";
import { PageTransition } from "@/components/app-shell/page-transition";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-svh bg-background">
      <Suspense fallback={null}>
        <CheckoutActivator />
      </Suspense>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
              <Image src="/logo-mark.png" alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
              SubSentry
            </Link>
            <PrimaryNav />
          </div>
          <div className="flex items-center gap-3 sm:gap-2">
            <Link
              href="/settings"
              aria-label={`Account: ${user.email}`}
              className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Avatar size="sm">
                <AvatarFallback className="bg-gold-muted text-gold">
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
  );
}
