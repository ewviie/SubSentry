import { formatCents } from "@/lib/subscriptions/money";
import type { BillingCycleEntry } from "@/lib/subscriptions/analytics";

const CYCLE_LABELS: Record<BillingCycleEntry["cycle"], string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  quarterly: "Quarterly",
  weekly: "Weekly",
};

// Identity across only 4 possible values with no ranking implied: plain
// labeled tiles rather than a pie/donut, which the dataviz form guide
// steers away from for anything beyond a single part-to-whole proportion.
export function BillingCycleCards({ entries, currency }: { entries: BillingCycleEntry[]; currency?: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a subscription to see this breakdown.</p>;
  }

  // Launch-readiness audit finding #3: grid-cols-2 was unconditional, so
  // the common single-cycle account (e.g. every subscription billed
  // monthly) rendered one small tile floating in a 2-column grid with the
  // second track left as dead space. entries.length === 1 drops to a
  // single, width-capped column instead — the tile no longer stretches to
  // fill a track it doesn't need. 2+ entries keep the original two-column
  // layout untouched.
  return (
    <div className={entries.length === 1 ? "grid max-w-xs grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
      {entries.map((entry) => (
        <div key={entry.cycle} className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">{CYCLE_LABELS[entry.cycle]}</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatCents(entry.monthlyCents, currency)}/mo</p>
          <p className="text-xs text-muted-foreground">
            {entry.count} subscription{entry.count === 1 ? "" : "s"}
          </p>
        </div>
      ))}
    </div>
  );
}
