import { Suspense } from "react";
import Link from "next/link";
import { ImportCenterPage } from "@/components/imports/import-center-page";
import { isPlaidConfigured } from "@/lib/imports/plaid-client";
import { isTrueLayerConfigured } from "@/lib/imports/truelayer-client";
import { isGmailConfigured } from "@/lib/imports/gmail-client";
import { getEmailConnection } from "@/lib/imports/email-connections";
import { requireUser } from "@/lib/auth/session";

// requireUser() (not just the (app) layout's own gate) because this page
// now needs session.user.id itself, to look up an existing Gmail
// connection. Every other page under this route group already follows
// this same pattern (see dashboard/page.tsx).
export default async function ImportPage() {
  const user = await requireUser();

  // Computed here, server-side, since only the server can read
  // PLAID_CLIENT_ID/PLAID_SECRET, TRUELAYER_CLIENT_ID/TRUELAYER_CLIENT_SECRET,
  // and GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. The client component below
  // only ever sees the resulting booleans (and, for Gmail, the already-
  // connected account's email/last-synced-at, never a token).
  const plaidEnabled = isPlaidConfigured();
  const trueLayerEnabled = isTrueLayerConfigured();
  const gmailEnabled = isGmailConfigured();
  const gmailConnection = gmailEnabled ? await getEmailConnection(user.id, "gmail") : undefined;

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
          route). Suspense boundary matches the same requirement
          CheckoutActivator already satisfies in the (app) layout. */}
      <Suspense fallback={null}>
        <ImportCenterPage
          plaidEnabled={plaidEnabled}
          trueLayerEnabled={trueLayerEnabled}
          gmailEnabled={gmailEnabled}
          gmailConnectedEmail={gmailConnection?.emailAddress ?? null}
          gmailLastSyncedAt={gmailConnection?.lastSyncedAt?.toISOString() ?? null}
        />
      </Suspense>
    </div>
  );
}
