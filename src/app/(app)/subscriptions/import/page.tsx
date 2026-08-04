import { Suspense } from "react";
import Link from "next/link";
import { ImportCenterPage } from "@/components/imports/import-center-page";
import { isPlaidConfigured } from "@/lib/imports/plaid-client";
import { isTrueLayerConfigured } from "@/lib/imports/truelayer-client";

// No requireUser() call here — the (app) layout already gates every page
// under this route group (see src/app/(app)/layout.tsx), matching the
// convention subscriptions/new/page.tsx already follows.
export default function ImportPage() {
  // Computed here, server-side, since only the server can read
  // PLAID_CLIENT_ID/PLAID_SECRET and TRUELAYER_CLIENT_ID/TRUELAYER_CLIENT_SECRET
  // — the client component below only ever sees the resulting booleans.
  const plaidEnabled = isPlaidConfigured();
  const trueLayerEnabled = isTrueLayerConfigured();

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back to subscriptions
        </Link>
        <Link
          href="/subscriptions/import/history"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View import history
        </Link>
      </div>
      {/* ImportCenterPage reads useSearchParams() to pick up TrueLayer's
          OAuth redirect landing (see connect-bank-step.tsx / the callback
          route) — Suspense boundary matches the same requirement
          CheckoutActivator already satisfies in the (app) layout. */}
      <Suspense fallback={null}>
        <ImportCenterPage plaidEnabled={plaidEnabled} trueLayerEnabled={trueLayerEnabled} />
      </Suspense>
    </div>
  );
}
