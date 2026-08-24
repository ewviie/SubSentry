import Link from "next/link";
import { CATEGORY_ICONS } from "@/lib/subscriptions/category-colors";
import { CATEGORY_BADGE_CLASSES } from "@/lib/subscriptions/category-colors";
import { formatCents } from "@/lib/subscriptions/money";
import type { TopMerchantEntry } from "@/lib/subscriptions/analytics";

export function TopMerchantsList({ merchants }: { merchants: TopMerchantEntry[] }) {
  if (merchants.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a subscription to see your top costs.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {merchants.map((merchant, i) => {
        const Icon = CATEGORY_ICONS[merchant.category];
        return (
          <li key={merchant.id}>
            <Link
              href={`/subscriptions/${merchant.id}`}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 hover:opacity-80"
            >
              <span className="w-4 text-sm font-medium text-muted-foreground tabular-nums">{i + 1}</span>
              <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${CATEGORY_BADGE_CLASSES[merchant.category]}`}>
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <span className="flex-1 truncate font-medium">{merchant.name}</span>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatCents(merchant.annualCents, merchant.currency)}/yr
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
