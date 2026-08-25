import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";
import { absoluteUrl } from "@/lib/seo";

// canonical resolved via absoluteUrl(), not a bare relative string. Same
// dynamic-route metadataBase gap as login/page.tsx; see lib/seo.ts.
export const metadata: Metadata = {
  title: "Forgot password",
  description: "Reset your SubSentry password.",
  alternates: { canonical: absoluteUrl("/forgot-password") ?? "/forgot-password" },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
