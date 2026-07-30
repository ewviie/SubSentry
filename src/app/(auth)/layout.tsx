import { redirect } from "next/navigation";
import { Anchor } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Authoritative check (not middleware's cookie-presence check) — see the
  // comment in src/middleware.ts for why: a stale/invalid cookie must not
  // bounce the user away from the login page they're trying to reach.
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4">
      <div className="flex items-center gap-2 font-heading text-lg font-semibold">
        <Anchor className="size-5" aria-hidden="true" />
        SubSentry
      </div>
      <AuthShell>{children}</AuthShell>
    </div>
  );
}
