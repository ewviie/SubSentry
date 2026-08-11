import type { Metadata } from "next";

// page.tsx is a client component (needs useSearchParams/useEffect for the
// token-verification flow), so it can't export metadata itself — a route
// segment's metadata has to come from a Server Component, hence this
// otherwise-empty layout. Noindex because this is a dead-end utility page,
// not a landing surface: nobody searches for it, it has no content of its
// own to show a searcher, and the flow it serves is currently dormant (see
// HANDOFF.md — email verification isn't part of the active signup path).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
