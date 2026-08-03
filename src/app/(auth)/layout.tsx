import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";
import { SentryRing } from "@/components/ui/sentry-ring";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Authoritative check (not proxy.ts's cookie-presence check) — see the
  // comment in src/proxy.ts for why: a stale/invalid cookie must not
  // bounce the user away from the login page they're trying to reach.
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4">
      <Link href="/" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
        <span aria-hidden="true" className="relative flex size-8 items-center justify-center">
          <SentryRing />
          <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-full rounded-full object-cover" />
        </span>
        SubSentry
      </Link>
      <main id="main-content">
        <AuthShell>{children}</AuthShell>
      </main>
    </div>
  );
}
