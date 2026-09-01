import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Mirrors SectionHeading's own two weights (see its comment, UI audit
// finding #3) so this skeleton doesn't reintroduce the exact layout-jump
// problem its own header comment already warns about for the cards below:
// Financial Overview is the one "primary"-weight section (bigger title,
// eyebrow-height gap kept), the other three are "secondary" (smaller
// title, tighter gap to the description) now that they no longer render
// an eyebrow line above the real heading either.
function SectionHeadingSkeleton({ weight = "primary" }: { weight?: "primary" | "secondary" }) {
  const isSecondary = weight === "secondary";
  return (
    <div className={cn("flex flex-wrap gap-3", isSecondary ? "items-center justify-between" : "items-end justify-between gap-4")}>
      <div className={isSecondary ? "space-y-1" : "space-y-2"}>
        <Skeleton className={isSecondary ? "h-5 w-40" : "h-6 w-48"} />
        <Skeleton className={isSecondary ? "h-3.5 w-56" : "h-4 w-64"} />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

// One shape, reused everywhere below a real card on this page is just a
// title over a few lines (AttentionPanel, RenewalForecastCard, the
// Savings opportunities and Analytics grids), kept as one skeleton instead
// of a bespoke one per card so this file stops silently drifting out of
// sync with the real layout the way it did before (see git history: this
// used to hardcode a 4-stat-card grid, a 2-card "Subscription Management"
// row, and a single big chart where the real page now has 2 stats, one
// wide card, and a small-card grid. Every one of those was a real,
// visible layout jump on load, not just a padding mismatch).
function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={i === lines - 1 ? "h-4 w-3/4" : "h-4 w-full"} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-11 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>

      {/* Financial overview: one OverviewPanel (monthly spend + health on
          the left, savings callout on the right), AttentionPanel,
          then Insights' own 2/3-col card grid. */}
      <div className="space-y-6">
        <SectionHeadingSkeleton />
        <Card className="p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:gap-10">
            <div className="flex flex-col gap-8">
              <div className="space-y-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-12 w-48" />
                <Skeleton className="h-4 w-56" />
              </div>
              <div className="flex items-center gap-4 border-t border-border pt-6">
                <Skeleton className="size-17 shrink-0 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-border pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-32" />
            </div>
          </div>
        </Card>
        <CardSkeleton lines={2} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Subscription management: QuickAddBar, one merged RenewalForecastCard
          (full width, not a 2-col pair), then the subscriptions list. */}
      <div className="space-y-6">
        <SectionHeadingSkeleton weight="secondary" />
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
        <CardSkeleton lines={3} />
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Savings opportunities: 3-col grid (score sits alone rather than
          stretching to match a list card's height; see the real section's
          own comment), up to 4 cards. */}
      <div className="space-y-6">
        <SectionHeadingSkeleton weight="secondary" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Analytics: category breakdown + 3 insight-engine cards, 2-col. */}
      <div className="space-y-6">
        <SectionHeadingSkeleton weight="secondary" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
