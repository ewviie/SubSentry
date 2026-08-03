import Link from "next/link";
import { ImportCenterPage } from "@/components/imports/import-center-page";

// No requireUser() call here — the (app) layout already gates every page
// under this route group (see src/app/(app)/layout.tsx), matching the
// convention subscriptions/new/page.tsx already follows.
export default function ImportPage() {
  return (
    <div className="max-w-4xl">
      <Link
        href="/subscriptions"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to subscriptions
      </Link>
      <ImportCenterPage />
    </div>
  );
}
