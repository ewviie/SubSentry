"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, PieChart, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fadeInUp, liftOnHover, revealViewport, springSnappy, staggerContainer } from "@/lib/motion";
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
        <h2 className="font-heading flex items-center gap-2 text-h2 font-semibold">
          <Sparkles className="size-4 text-ai" />
          Insights
        </h2>
        {!narrated && insights.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={handleNarrate} disabled={loading}>
            {loading ? "Thinking…" : "Rewrite with AI"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      {insights.length === 0 ? (
        <Card className="mt-4 shadow-elevation-low">
          <CardContent className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">Nothing needs your attention</p>
              <p className="text-sm text-muted-foreground">
                No overdue renewals, overlaps, or cost spikes flagged right now.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          variants={staggerContainer(0.06)}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="mt-4 grid gap-3 sm:grid-cols-2"
        >
          {insights.map((insight, idx) => {
            const Icon = ICONS[insight.type];
            const singleSubscriptionId =
              insight.subscriptionIds.length === 1 ? insight.subscriptionIds[0] : null;
            return (
              <motion.div
                key={`${idx}-${insight.type}-${insight.subscriptionIds.join(",")}`}
                variants={fadeInUp}
                whileHover={liftOnHover}
                transition={springSnappy}
              >
                <Card className="h-full shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium">
                  <CardContent className="flex h-full flex-col gap-3 pt-4">
                    <div className="flex gap-3">
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
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{insight.title}</p>
                          {/* Severity signaled by text, not color alone — a
                              colorblind reader can't distinguish the
                              destructive/10 vs ai-muted icon backgrounds
                              above by hue. */}
                          <span
                            className={
                              insight.severity === "warning"
                                ? "shrink-0 text-[0.65rem] font-medium tracking-wide text-destructive uppercase"
                                : "shrink-0 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase"
                            }
                          >
                            {insight.severity === "warning" ? "Action needed" : "Worth noting"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{descriptions[idx]}</p>
                      </div>
                    </div>
                    <Link
                      href={singleSubscriptionId ? `/subscriptions/${singleSubscriptionId}` : "/subscriptions"}
                      className="mt-auto text-xs font-medium text-foreground hover:underline"
                    >
                      Review →
                    </Link>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
