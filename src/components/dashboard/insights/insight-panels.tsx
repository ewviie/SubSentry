import Link from "next/link";
import { Lock, Sparkles, ShieldCheck, TrendingUp, CalendarClock, AlertTriangle, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import { getSavingsPriority, PRIORITY_LABEL, PRIORITY_BADGE_VARIANT } from "@/lib/subscriptions/savings";
import type { EngineOutput } from "@/lib/insights-engine";

// One file, several small presentational panels — kept together since each
// is a thin render over a single slice of EngineOutput with no shared state,
// avoiding per-component import/boilerplate overhead for what are
// otherwise ~20-40 line components.

function PremiumLocked({ title, upgradeUrl }: { title: string; upgradeUrl: string | null }) {
  return (
    <Card className="shadow-elevation-low">
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
    <Card className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald" aria-hidden="true" />
          Quick wins
        </CardTitle>
        <CardDescription>The most actionable things worth reviewing right now.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {output.quickWins.map((win) => (
          <div key={win.ruleId} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{win.title}</p>
              <p className="text-muted-foreground">{win.description}</p>
            </div>
            {win.monthlySavingsCents ? (
              <Badge className="shrink-0 bg-emerald text-emerald-foreground">{formatCents(win.monthlySavingsCents)}/mo</Badge>
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
    <Card className="shadow-elevation-low">
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

export function RenewalForecastCard({ output }: { output: EngineOutput }) {
  const { renewalForecast: f } = output;
  return (
    <Card className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-chart-4" aria-hidden="true" />
          Renewal forecast
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Next renewal</p>
          <p className="font-medium">{f.nextRenewal ? `${f.nextRenewal.name} · ${f.nextRenewal.date}` : "None upcoming"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Due next 30 days</p>
          <p className="font-mono font-medium tabular-nums">{formatCents(f.totalDueNext30DaysCents)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Busiest month</p>
          <p className="font-medium">{f.busiestPeriod ? `${f.busiestPeriod.monthLabel} (${formatCents(f.busiestPeriod.totalCents)})` : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Largest upcoming payment</p>
          <p className="font-medium">{f.largestUpcomingPayment ? `${f.largestUpcomingPayment.name} (${formatCents(f.largestUpcomingPayment.cents)})` : "—"}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SavingsOpportunitiesCard({ output }: { output: EngineOutput }) {
  if (output.savingsForecast.recommendations.length === 0) return null;
  return (
    <Card className="shadow-elevation-low">
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
      <CardContent className="space-y-2">
        {output.savingsForecast.recommendations.slice(0, 4).map((rec) => (
          <div key={rec.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{rec.title}</span>
              <Badge variant={PRIORITY_BADGE_VARIANT[getSavingsPriority(rec)]} className="shrink-0">
                {PRIORITY_LABEL[getSavingsPriority(rec)]}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
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

export function ScoreBreakdownCard({ output }: { output: EngineOutput }) {
  if (!output.healthScore) return null;
  return (
    <Card className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
          How your score was calculated
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {output.healthScore.breakdown.map((entry) => (
          <div key={entry.label} className="flex items-baseline gap-2 text-sm">
            <span
              className={
                entry.delta > 0
                  ? "w-10 shrink-0 font-mono font-medium text-emerald"
                  : entry.delta < 0
                    ? "w-10 shrink-0 font-mono font-medium text-destructive"
                    : "w-10 shrink-0 font-mono font-medium text-muted-foreground"
              }
            >
              {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
            </span>
            <span className="text-muted-foreground">{entry.label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function OptimizationScoreCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) return <PremiumLocked title="Optimization score" upgradeUrl={upgradeUrl} />;
  if (!output.optimizationScore) return null;
  return (
    <Card className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Optimization score</CardTitle>
        <CardDescription>
          Unrealized savings from confirmed duplicates, as a share of your current spend — separate from Health.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-4xl font-semibold tabular-nums">{output.optimizationScore.score}<span className="text-lg text-muted-foreground">/100</span></p>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCents(output.optimizationScore.unrealizedYearlySavingsCents)}/yr in confirmed duplicate savings identified.
          {/* This score is deliberately scoped to confirmed duplicates only
              (same computation as Savings opportunities above) — it can
              read 100/100 "nothing found" while Optimization recommendations
              below still surfaces a real, different dollar figure (e.g. an
              annual-billing-cycle discount), which is a distinct signal this
              score doesn't fold in. Said explicitly so the two cards don't
              read as contradicting each other. */}
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
    <Card className="shadow-elevation-low">
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
    <Card className="border-destructive/30 shadow-elevation-low">
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
