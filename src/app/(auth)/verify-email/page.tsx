import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailContent } from "./verify-email-content";

// Split into a server page (this file, for metadata) + a client component
// (verify-email-content.tsx, for the useSearchParams()/fetch status logic)
// (same shape as login/page.tsx + login-form.tsx). This page used to be a
// single "use client" file with no way to export `metadata`, which is why
// a sibling layout.tsx existed containing nothing but a `robots: noindex`
// export (its own comment said so explicitly). The title/description
// below now live directly on the page like every other auth page
// (reset-password/page.tsx is the closest match: noindex + a real title,
// no canonical either, since a noindexed page isn't meant to be found via
// search in the first place), so that now-redundant layout.tsx was
// deleted rather than left as dead scaffolding.
//
// Still noindex, nofollow: this remains the dead-end utility page
// layout.tsx's comment described (nobody searches for it, and per
// HANDOFF.md email verification isn't part of the active signup path);
// only the "no title" side effect of the client-component constraint was
// the actual gap, not the indexability decision itself.
export const metadata: Metadata = {
  title: "Verify email",
  description: "Verify your email address to finish setting up your SubSentry account.",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
