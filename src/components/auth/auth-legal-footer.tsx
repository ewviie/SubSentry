"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Hidden on signup specifically: signup already has its own, more specific
// consent block (the required checkbox in signup-form.tsx, right above the
// submit button) plus an AI-usage disclosure that also links Terms. A
// third, generic "Terms · Privacy" nav directly below that stacked three
// separate legal touchpoints on one screen. Kept everywhere else in this
// layout (login, forgot-password, reset-password, verify-email), which have
// no other legal copy on the page at all: this is the only way to reach
// the policies from those screens.
export function AuthLegalFooter() {
  const pathname = usePathname();
  if (pathname === "/signup") return null;

  return (
    <nav aria-label="Legal" className="flex items-center gap-4 text-xs text-muted-foreground">
      <Link href="/terms" className="hover:text-foreground hover:underline">Terms</Link>
      <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy</Link>
    </nav>
  );
}
