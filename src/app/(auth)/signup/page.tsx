import type { Metadata } from "next";
import { SignupForm } from "./signup-form";
import { absoluteUrl } from "@/lib/seo";

// canonical resolved via absoluteUrl(), not a bare relative string — same
// dynamic-route metadataBase gap as login/page.tsx; see lib/seo.ts.
export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a free SubSentry account and start tracking what you're actually paying for.",
  alternates: { canonical: absoluteUrl("/signup") ?? "/signup" },
};

export default function SignupPage() {
  return <SignupForm />;
}
