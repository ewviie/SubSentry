import type { Metadata } from "next";
import { LoginForm } from "./login-form";

// Distinct from the root layout's default "SubSentry" title/description —
// every page previously inherited that same pair verbatim (nothing
// overrode it), which is exactly the kind of "every page looks identical
// to a crawler" issue worth a real, page-specific title for a public page
// like this one.
export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your SubSentry account to track and manage your subscriptions.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <LoginForm />;
}
