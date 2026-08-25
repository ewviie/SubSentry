import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";

export function ImportCompleteStep({
  importedCount,
  ignoredCount,
  total,
  onImportAnother,
}: {
  importedCount: number;
  ignoredCount: number;
  // null whenever the imported batch spanned more than one currency, see
  // sumMonthlyCentsIfSingleCurrency's own comment in lib/subscriptions/money.ts.
  // Omitted from this screen entirely rather than shown as a wrong number.
  total: { totalMonthlyCents: number; currency: string } | null;
  onImportAnother: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-emerald-muted text-emerald">
        <CheckCircle2 className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-heading text-xl font-semibold">
          Imported {importedCount} subscription{importedCount === 1 ? "" : "s"}
        </p>
        {/* The one real financial-consequence moment this screen was
            missing. reveal-step.tsx already proved this exact number is
            worth showing one screen earlier (the pre-confirm estimate);
            this is the same figure, now real and saved, not projected. */}
        {total ? (
          <p className="font-mono text-lg font-semibold tabular-nums text-emerald">
            {formatCents(total.totalMonthlyCents, total.currency)}/mo now tracked
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {ignoredCount > 0 ? `${ignoredCount} ignored.` : "Nothing was ignored."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {/* /dashboard, not /subscriptions: the dashboard is where the
            total/savings/insights this import just fed into actually show
            up; a first-time import in particular may have nothing on
            /savings yet (needs a duplicate/overlap to flag), so that isn't
            promised here as the payoff. */}
        <Button render={<Link href="/dashboard" />} nativeButton={false}>
          Go to dashboard
        </Button>
        <Button variant="outline" onClick={onImportAnother}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
