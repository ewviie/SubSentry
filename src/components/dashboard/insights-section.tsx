"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, PieChart, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
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

// Same status-only PATCH, same toast-then-refresh pattern
// EditSubscriptionForm's own "Mark as canceled" already uses (see its
// comment: acting on a plain text recommendation used to mean opening the
// full edit form, finding Status among 7 other fields, and saving). An
// overdue-renewal insight naming exactly one subscription is the single
// clearest case on this whole dashboard where "what should I do about
// this" has one unambiguous, one-click answer — SubSentry can't know
// whether it's actually still active, but it can make "no, cancel it"
// take one click instead of a full page trip.
function MarkOverdueCanceled({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter();
  const [canceling, setCanceling] = useState(false);

  async function handleCancel() {
    setCanceling(true);
    try {
      const res = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Couldn't cancel that. Try again.");
        return;
      }
      toast.success("Marked canceled");
      router.refresh();
    } catch {
      toast.error("Couldn't cancel that. Try again.");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <Button size="sm" variant="outline" className="w-fit" onClick={handleCancel} disabled={canceling}>
      {canceling ? (
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <Check className="size-3.5" aria-hidden="true" />
      )}
      Mark canceled
    </Button>
  );
}

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
        <Card size="sm" className="mt-4 shadow-elevation-low">
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
                No overdue renewals or cost spikes flagged right now.
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
          className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
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
                <Card size="sm" className="h-full shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium">
                  {/* No pt override here on purpose. The empty-state Card
                      just above (when insights.length === 0) doesn't add one
                      either, and this used to disagree with it for no
                      documented reason, stacking an extra pt-4 on top of the
                      Card's own padding. size="sm" alone gets a noticeably
                      more compact card without losing any information. */}
                  <CardContent className="flex h-full flex-col gap-2">
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
                          {/* Severity signaled by text, not color alone. A
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
                    <div className="mt-auto flex flex-wrap items-center gap-3">
                      <Link
                        href={singleSubscriptionId ? `/subscriptions/${singleSubscriptionId}` : "/subscriptions"}
                        className="text-xs font-medium text-foreground hover:underline"
                      >
                        Review →
                      </Link>
                      {/* Only when this insight names exactly one
                          subscription: a multi-subscription overdue insight
                          has no single unambiguous target to cancel, and
                          canceling the wrong one of several would be worse
                          than the friction this button removes. */}
                      {insight.type === "overdue_renewal" && singleSubscriptionId ? (
                        <MarkOverdueCanceled subscriptionId={singleSubscriptionId} />
                      ) : null}
                    </div>
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
