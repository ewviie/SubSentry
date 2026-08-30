import type { Metadata } from "next";
import { SignupForm } from "./signup-form";
import { absoluteUrl } from "@/lib/seo";
import { isBetaAllAccess } from "@/lib/billing/plan";

// canonical resolved via absoluteUrl(), not a bare relative string. Same
// dynamic-route metadataBase gap as login/page.tsx; see lib/seo.ts.
export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a free SubSentry account and start tracking what you're actually paying for.",
  alternates: { canonical: absoluteUrl("/signup") ?? "/signup" },
};

export default function SignupPage() {
  // isBetaAllAccess() reads an env var + a module constant — resolved here,
  // server-side, and passed down as a plain boolean prop, rather than
  // called from signup-form.tsx directly: that file is a client component,
  // and only NEXT_PUBLIC_-prefixed env vars are ever inlined into a client
  // bundle, so a client-side call would silently miss DEV_DISABLE_BETA_ACCESS
  // (see plan.ts's own comment on that flag).
  return <SignupForm isBetaAllAccess={isBetaAllAccess()} />;
}
