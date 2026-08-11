import Link from "next/link";
import { Copy } from "lucide-react";
import type { Subscription } from "@/lib/db/schema";

// Surfaces the same "possible duplicate" signal the subscriptions list
// already badges (subscription-row.tsx) and computeInsights() already
// computes — not a new detection, just a place for that existing signal to
// show up again on the one screen a user is most likely to act on it from.
// `match` is always a real subscription this user owns, resolved from the
// same possible_overlap insight the list's badge reads (see
// subscriptions/[id]/page.tsx) — never a guessed or invented pairing.
export function DuplicateNotice({ match }: { match: Subscription }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
      <Copy className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-medium text-destructive">Possible duplicate</p>
        <p className="mt-0.5 text-muted-foreground">
          This looks like the same service as{" "}
          <Link href={`/subscriptions/${match.id}`} className="font-medium text-foreground underline underline-offset-4">
            {match.name}
          </Link>
          , which renews {match.nextRenewalDate}.
        </p>
      </div>
    </div>
  );
}
