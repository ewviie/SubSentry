import Link from "next/link";
import { Lock, Sparkles, ShieldCheck, TrendingUp, CalendarClock, AlertTriangle, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RenewalsList } from "@/components/dashboard/renewals-list";
import { formatCents } from "@/lib/subscriptions/money";
import { getSavingsPriority, PRIORITY_LABEL, PRIORITY_BADGE_VARIANT } from "@/lib/subscriptions/savings";
import type { EngineOutput } from "@/lib/insights-engine";
import type { Subscription } from "@/lib/db/schema";

// One file, several small presentational panels — kept together since each
// is a thin render over a single slice of EngineOutput with no shared state,
// avoiding per-component import/boilerplate overhead for what are
// otherwise ~20-40 line components.

function PremiumLocked({ title, upgradeUrl }: { title: string; upgradeUrl: string | null }) {
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title} is a Pro feature</p>
          <p className="text-sm text-muted-foreground">Upgrade to unlock this insight.</p>
        </div>
        {upgradeUrl ? (
          <Button size="sm" variant="outline" render={<a href={upgradeUrl} />} nativeButton={false}>
            Upgrade
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function QuickWinsCard({ output }: { output: EngineOutput }) {
  if (output.quickWins.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald" aria-hidden="true" />
          Quick wins
        </CardTitle>
        <CardDescription>The most actionable things worth reviewing right now.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {output.quickWins.map((win) => (
          <div key={win.ruleId} className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{win.title}</p>
                <p className="text-muted-foreground">{win.description}</p>
              </div>
              {win.monthlySavingsCents ? (
                <Badge className="shrink-0 bg-emerald text-emerald-foreground">{formatCents(win.monthlySavingsCents)}/mo</Badge>
              ) : null}
            </div>
            {/* Same "one clear next click" pattern SavingsOpportunitiesCard
                already uses — only rendered when this finding actually
                points at a specific subscription (some health-rule findings,
                e.g. a renewal spike, are account-wide and have none). */}
            {win.subscriptionIds[0] ? (
              <Button size="sm" variant="outline" className="w-fit" render={<Link href={`/subscriptions/${win.subscriptionIds[0]}`} />} nativeButton={false}>
                Review
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PositiveHabitsCard({ output }: { output: EngineOutput }) {
  if (output.positive.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald" aria-hidden="true" />
          Positive financial habits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {output.positive.map((p) => (
          <p key={p.ruleId} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{p.title}.</span> {p.description}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

// Used to be two side-by-side cards (a 4-stat forecast grid, and a plain
// "Upcoming renewals" list right next to it) that both led with the exact
// same fact — the forecast's "Next renewal" stat and the list's first row
// were always the same subscription and date. One merged card: a compact
// stat strip for the three numbers the list itself can't show (a 30-day
// total, which month is busiest, which single payment is biggest), then the
// actual chronological list right below it — so the list *is* the answer to
// "what's renewing next" instead of restating it as a fourth stat above it.
export function RenewalForecastCard({ output, renewals }: { output: EngineOutput; renewals: Subscription[] }) {
  const { renewalForecast: f } = output;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-chart-4" aria-hidden="true" />
          Renewals
        </CardTitle>
      </CardHeader>
      {/* space-y-2 here, not the usual space-y-4 — the stat strip below
          already has its own pb-4 separating its numbers from the divider
          line; stacking a second full 16px gap on top of that (before the
          list's own row padding even starts) made the gap under the divider
          roughly 2.5x the gap between the list's own rows, which read as
          uneven rather than as intentional breathing room. */}
      <CardContent className="space-y-2">
        {/* grid-cols-3 with no responsive override squeezed each stat into
            ~120px on a phone-width screen — "Biggest payment" wrapped to two
            lines while its neighbors didn't, so the three columns landed at
            different heights and the whole strip read as misaligned. One
            column below sm, 3-across once there's actually room. */}
        <div className="grid grid-cols-1 gap-3 border-b border-border pb-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Due in 30 days</p>
            <p className="font-mono font-medium tabular-nums">{formatCents(f.totalDueNext30DaysCents)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Busiest month</p>
            <p className="font-medium">{f.busiestPeriod ? f.busiestPeriod.monthLabel : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Biggest payment</p>
            <p className="font-medium">{f.largestUpcomingPayment ? f.largestUpcomingPayment.name : "—"}</p>
          </div>
        </div>
        <RenewalsList renewals={renewals} />
      </CardContent>
    </Card>
  );
}

export function SavingsOpportunitiesCard({ output }: { output: EngineOutput }) {
  if (output.savingsForecast.recommendations.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Savings opportunities</CardTitle>
        <CardDescription>
          {/* Only counts confirmed duplicate matches (deterministic
              name-matching, never a guessed percentage) — the list below can
              include category-concentration items ("N active streaming
              subscriptions") that are worth a look but aren't credited with
              a dollar figure the app can't back up. Saying "potential" here
              without qualifying it reads as if this total covers every item
              listed below it, including the $0-confidence ones — it doesn't. */}
          {formatCents(output.savingsForecast.monthlySavingsCents)}/mo · {formatCents(output.savingsForecast.yearlySavingsCents)}/yr
          from confirmed duplicates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {output.savingsForecast.recommendations.slice(0, 4).map((rec) => (
          // Used to be one row (title ... button) with the title truncated
          // to make room — fine at 2-up, but 3-up (see the grid this renders
          // in) narrowed the column enough that real titles like "3 active
          // other subscriptions" clipped mid-word. Wrapping instead of
          // truncating, with the button on its own line, is exactly the
          // pattern SavingsRecommendationCard already uses on /savings for
          // this same content — no cut-off text at any column width.
          <div key={rec.id} className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span>{rec.title}</span>
              <Badge variant={PRIORITY_BADGE_VARIANT[getSavingsPriority(rec)]} className="shrink-0">
                {PRIORITY_LABEL[getSavingsPriority(rec)]}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              render={<Link href={`/subscriptions/${rec.targetSubscriptionId}`} />}
              nativeButton={false}
            >
              {rec.actionLabel}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Status dot color/label pairs — color alone never carries the meaning
// (see InsightsSection's identical "text + color, never color alone"
// convention elsewhere on this dashboard); the word is always visible too.
const DIMENSION_STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  good: { dot: "bg-emerald", label: "Good" },
  watch: { dot: "bg-chart-4", label: "Worth a look" },
  attention: { dot: "bg-destructive", label: "Needs attention" },
  // Zero rules in this dimension had enough evidence to form an opinion
  // (e.g. one brand-new subscription) — a neutral gray, not a false "good".
  unknown: { dot: "bg-muted-foreground/40", label: "Not enough data" },
};

export function ScoreBreakdownCard({ output }: { output: EngineOutput }) {
  if (!output.healthScore) return null;
  const { dimensions, confidence } = output.healthScore;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
          How your score was calculated
        </CardTitle>
        {/* Only shown for medium/low — high confidence needs no caveat (see
            health-score.ts's computeConfidence). Never invents a "we've
            been watching for months" claim; just an honest read of how much
            data actually backs this score. */}
        {confidence.level !== "high" ? (
          <CardDescription>
            Confidence: {confidence.level === "medium" ? "Medium" : "Low"} — {confidence.reason}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {dimensions.map((dimension) => {
          const style = DIMENSION_STATUS_STYLE[dimension.status];
          return (
            <div key={dimension.key} className="flex items-start gap-2.5 text-sm">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium">{dimension.label}</span>
                  <span className="text-xs text-muted-foreground">({style.label})</span>
                </div>
                <p className="text-muted-foreground">{dimension.summary}</p>
                {/* Only a dimension with real negative evidence ever has
                    one (see health-score.ts's recommendedActionFor) — a
                    clean dimension shows just the summary above, never a
                    manufactured task. */}
                {dimension.recommendedAction ? (
                  <p className="mt-0.5 font-medium text-foreground">{dimension.recommendedAction}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function OptimizationScoreCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) return <PremiumLocked title="Optimization score" upgradeUrl={upgradeUrl} />;
  if (!output.optimizationScore) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Optimization score</CardTitle>
        <CardDescription>
          Unrealized savings across every finding below — confirmed duplicates plus estimated optimizations — as a
          share of your current spend, separate from Health.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-4xl font-semibold tabular-nums">{output.optimizationScore.score}<span className="text-lg text-muted-foreground">/100</span></p>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCents(output.optimizationScore.unrealizedYearlySavingsCents)}/yr identified: confirmed duplicates
          (Savings opportunities) plus estimates from Optimization recommendations below.
          {/* This now folds in every optimization-category rule's
              monthlySavingsCents (see engine.ts), not just confirmed
              duplicates — so it can no longer read 100/100 "nothing found"
              while Optimization recommendations still shows a real dollar
              figure underneath it. Savings opportunities above stays
              duplicates-only on purpose (see its own comment); this score is
              the one place the two signals are meant to combine. */}
        </p>
      </CardContent>
    </Card>
  );
}

export function AiRecommendationsCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) return <PremiumLocked title="Optimization recommendations" upgradeUrl={upgradeUrl} />;
  const suggestions = output.premiumInsights.filter((r) => r.category === "optimization");
  if (suggestions.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-ai" aria-hidden="true" />
          Optimization recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s) => (
          <p key={s.ruleId} className="text-sm">
            <span className="font-medium">{s.title}.</span>{" "}
            <span className="text-muted-foreground">{s.description}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

export function RiskAlertsCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) return <PremiumLocked title="Risk alerts" upgradeUrl={upgradeUrl} />;
  const risks = output.premiumInsights.filter((r) => r.category === "usage");
  if (risks.length === 0) return null;
  return (
    <Card size="sm" className="border-destructive/30 shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          Risk alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {risks.map((r) => (
          <div key={r.ruleId} className="text-sm">
            <p className="font-medium">{r.title}</p>
            <p className="text-muted-foreground">{r.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
