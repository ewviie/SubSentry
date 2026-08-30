import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthLegalFooter } from "@/components/auth/auth-legal-footer";
import { SentryRing } from "@/components/ui/sentry-ring";
import { NonceProvider } from "@/components/security/nonce-context";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Authoritative check (not proxy.ts's cookie-presence check). See the
  // comment in src/proxy.ts for why: a stale/invalid cookie must not
  // bounce the user away from the login page they're trying to reach.
  const session = await getSession();
  if (session) redirect("/dashboard");

  // Set by proxy.ts on every request; read here (a Server Component) and
  // handed to client components several layers below (the signup/login
  // pages' Turnstile widget) via context. See nonce-context.tsx for why
  // this can't just be a prop or a build-time constant.
  const nonce = (await headers()).get("x-nonce");

  return (
    <NonceProvider nonce={nonce}>
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4">
        <div className="flex flex-col items-center gap-1.5">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
            <span aria-hidden="true" className="relative flex size-8 items-center justify-center">
              <SentryRing />
              <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-full rounded-full object-cover" />
            </span>
            SubSentry
          </Link>
          {/* One quiet tagline, shared by both login and signup, rather than
              repeating a value proposition inside each page's own card:
              login's job is to get a returning user back in with no
              friction, so its own CardDescription stays "Log in to your
              SubSentry dashboard" — the brand/value context a first-time
              visitor needs lives here instead, where it reads as part of
              the wordmark rather than an ad bolted onto the login form. */}
          <p className="text-xs text-muted-foreground">Know exactly what you&apos;re paying for.</p>
        </div>
        {/* w-full max-w-sm here (not just on AuthShell) is load-bearing: `main`
            has no width of its own otherwise, so AuthShell's `w-full` had
            nothing meaningful to be 100% of. It was resolving against
            whatever `main`'s shrink-to-fit content width happened to be
            (as little as ~120px on the signup confirmation screen, verified
            in a real browser), not the intended 384px, causing real text
            overflow on narrower content. Giving `main` the same constraint
            makes the intended max-width authoritative at this level, and
            AuthShell's own w-full now resolves against it correctly. */}
        <main id="main-content" className="w-full max-w-sm">
          <AuthShell>{children}</AuthShell>
        </main>
        <AuthLegalFooter />
      </div>
    </NonceProvider>
  );
}
