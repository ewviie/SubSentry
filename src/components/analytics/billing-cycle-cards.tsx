import { formatCents } from "@/lib/subscriptions/money";
import type { BillingCycleEntry } from "@/lib/subscriptions/analytics";

const CYCLE_LABELS: Record<BillingCycleEntry["cycle"], string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  quarterly: "Quarterly",
  weekly: "Weekly",
};

// Identity across only 4 possible values with no ranking implied — plain
// labeled tiles rather than a pie/donut, which the dataviz form guide
// steers away from for anything beyond a single part-to-whole proportion.
export function BillingCycleCards({ entries }: { entries: BillingCycleEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a subscription to see this breakdown.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {entries.map((entry) => (
        <div key={entry.cycle} className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">{CYCLE_LABELS[entry.cycle]}</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatCents(entry.monthlyCents)}/mo</p>
          <p className="text-xs text-muted-foreground">
            {entry.count} subscription{entry.count === 1 ? "" : "s"}
          </p>
        </div>
      ))}
    </div>
  );
}
