import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { CheckoutActivator } from "@/components/billing/checkout-activator";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-svh bg-background">
      <Suspense fallback={null}>
        <CheckoutActivator />
      </Suspense>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="font-heading text-lg font-semibold">
            Doubloon
          </Link>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Settings
            </Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
