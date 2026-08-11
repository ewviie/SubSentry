import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { absoluteUrl } from "@/lib/seo";

// Distinct from the root layout's default "SubSentry" title/description —
// every page previously inherited that same pair verbatim (nothing
// overrode it), which is exactly the kind of "every page looks identical
// to a crawler" issue worth a real, page-specific title for a public page
// like this one.
//
// canonical resolved via absoluteUrl(), not a bare relative string — this
// whole route group is dynamically rendered (the (auth) layout calls
// getSession() on every request), and metadataBase resolution doesn't
// apply to a dynamic route's relative alternates.canonical the way it
// does for a static one. See lib/seo.ts's own comment.
export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your SubSentry account to track and manage your subscriptions.",
  alternates: { canonical: absoluteUrl("/login") ?? "/login" },
};

export default function LoginPage() {
  return <LoginForm />;
}
