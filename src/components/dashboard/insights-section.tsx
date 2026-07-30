"use client";

import { useState } from "react";
import { AlertTriangle, Copy, PieChart, Sparkles, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ComputedInsight, InsightType } from "@/lib/subscriptions/insights";

const ICONS: Record<InsightType, typeof TrendingUp> = {
  expensive_category: PieChart,
  overdue_renewal: AlertTriangle,
  high_yearly_spend: TrendingUp,
  possible_overlap: Copy,
};

export function InsightsSection({ insights }: { insights: ComputedInsight[] }) {
  const [descriptions, setDescriptions] = useState(() => insights.map((i) => i.description));
  const [loading, setLoading] = useState(false);
  const [narrated, setNarrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (insights.length === 0) return null;

  async function handleNarrate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/narrate-insights", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Couldn't reach the AI. Try again.");
        return;
      }
      if (Array.isArray(data.narrations) && data.narrations.length === insights.length) {
        setDescriptions(data.narrations);
        setNarrated(true);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-heading flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-4 text-ai" />
          Insights
        </h2>
        {!narrated ? (
          <Button variant="ghost" size="sm" onClick={handleNarrate} disabled={loading}>
            {loading ? "Thinking…" : "Rewrite with AI"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {insights.map((insight, idx) => {
          const Icon = ICONS[insight.type];
          return (
            <Card key={`${idx}-${insight.type}-${insight.subscriptionIds.join(",")}`}>
              <CardContent className="flex gap-3 pt-6">
                <div
                  className={
                    insight.severity === "warning"
                      ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                      : "flex size-8 shrink-0 items-center justify-center rounded-full bg-ai-muted text-ai"
                  }
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{descriptions[idx]}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
