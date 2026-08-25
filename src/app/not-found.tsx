import type { Metadata } from "next";
import Link from "next/link";

// Previously unset: this page inherited the root layout's bare
// "SubSentry" title verbatim, same generic-title gap the rest of this
// audit pass fixed on every other public page (see e.g. login/page.tsx's
// comment).
//
// No explicit `robots` field here: Next.js already auto-injects
// `<meta name="robots" content="noindex">` on any not-found render
// (verified against a real production build). Setting one here too
// doesn't override it, it adds a second, separate `<meta name="robots">`
// tag alongside Next's own: duplicate, invalid HTML for a page this
// audit pass is specifically trying to make more correct, not less.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function RootNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-medium">Page not found</h1>
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Back home
      </Link>
    </div>
  );
}
