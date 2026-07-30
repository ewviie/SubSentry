import type { Subscription } from "@/lib/db/schema";
import { monthlyCents, formatCents } from "./money";
import { CATEGORY_LABELS } from "./labels";

export type InsightType =
  | "expensive_category"
  | "overdue_renewal"
  | "high_yearly_spend"
  | "possible_overlap";

export interface ComputedInsight {
  type: InsightType;
  title: string;
  description: string;
  severity: "info" | "warning";
  subscriptionIds: string[];
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Two subscription names count as a likely duplicate if, once lowercased
// and stripped of punctuation/whitespace, one contains the other (catches
// "Netflix" vs "Netflix Premium", "Disney+" vs "disney plus"-ish variants)
// or they're within a small edit distance of each other.
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Takes already-normalized names — computeInsights() normalizes each active
// subscription's name once, outside the O(n²) comparison loop below, rather
// than recomputing it on every pair.
function namesLikelyMatch(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 4 && normB.length >= 4 && (normA.includes(normB) || normB.includes(normA))) {
    return true;
  }
  // Edit distance is always >= the length difference, so anything more than
  // 2 apart can never pass the <= 2 threshold below — skip the O(n*m)
  // levenshtein computation entirely for those pairs.
  if (Math.abs(normA.length - normB.length) > 2) return false;
  return levenshtein(normA, normB) <= 2;
}

// All detection here is deterministic — plain computation over data already
// in Postgres, not an LLM call. See src/lib/ai/provider.ts's narrateInsights
// for the optional layer that turns these into looser prose; the detection
// itself stays instant, free, and 100% reproducible regardless of whether
// that optional step runs.
export function computeInsights(allSubscriptions: Subscription[]): ComputedInsight[] {
  const insights: ComputedInsight[] = [];
  const active = allSubscriptions.filter((s) => s.status === "active");
  if (active.length === 0) return insights;

  const monthlyTotal = active.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);

  // 1. Expensive category — one category eating an outsized share of spend.
  if (monthlyTotal > 0) {
    const byCategory = new Map<Subscription["category"], { cents: number; ids: string[] }>();
    for (const s of active) {
      const entry = byCategory.get(s.category) ?? { cents: 0, ids: [] };
      entry.cents += monthlyCents(s.amountCents, s.billingCycle);
      entry.ids.push(s.id);
      byCategory.set(s.category, entry);
    }
    const [topCategory, topEntry] = Array.from(byCategory.entries()).sort(
      (a, b) => b[1].cents - a[1].cents,
    )[0];
    const share = topEntry.cents / monthlyTotal;
    if (byCategory.size > 1 && share >= 0.4) {
      insights.push({
        type: "expensive_category",
        title: `${CATEGORY_LABELS[topCategory]} is your biggest expense`,
        description: `${CATEGORY_LABELS[topCategory]} makes up ${Math.round(share * 100)}% of your monthly spend (${formatCents(topEntry.cents)}/mo). Worth a look if that's higher than expected.`,
        severity: "info",
        subscriptionIds: topEntry.ids,
      });
    }
  }

  // 2. Overdue renewal — active subscription whose renewal date has passed,
  // suggesting it was cancelled elsewhere or the date was never updated.
  const today = todayISO();
  const overdue = active.filter((s) => s.nextRenewalDate < today);
  for (const s of overdue.slice(0, 3)) {
    insights.push({
      type: "overdue_renewal",
      title: `${s.name}'s renewal date has passed`,
      description: `${s.name} was due to renew on ${s.nextRenewalDate}. If it's still active, update the date — if not, mark it canceled.`,
      severity: "warning",
      subscriptionIds: [s.id],
    });
  }

  // 3. High yearly spend — subscriptions costing meaningfully more than a
  // typical subscription for this user (relative outlier, not a fixed
  // dollar threshold, so it scales with each user's own spending level).
  if (active.length >= 2) {
    const annualCosts = active.map((s) => ({
      sub: s,
      annual: monthlyCents(s.amountCents, s.billingCycle) * 12,
    }));
    const meanAnnual = annualCosts.reduce((sum, c) => sum + c.annual, 0) / annualCosts.length;
    const outliers = annualCosts
      .filter((c) => c.annual >= meanAnnual * 2 && c.annual >= 3000)
      .sort((a, b) => b.annual - a.annual);
    for (const { sub, annual } of outliers.slice(0, 2)) {
      insights.push({
        type: "high_yearly_spend",
        title: `${sub.name} adds up fast`,
        description: `${sub.name} costs ${formatCents(annual)}/year — more than double what you spend on a typical subscription here.`,
        severity: "info",
        subscriptionIds: [sub.id],
      });
    }
  }

  // 4. Possible overlap/duplicates — same or near-identical names, or
  // multiple active subscriptions in the same category.
  const normalizedNames = active.map((s) => normalizeName(s.name));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (namesLikelyMatch(normalizedNames[i], normalizedNames[j])) {
        insights.push({
          type: "possible_overlap",
          title: `Possible duplicate: ${active[i].name} and ${active[j].name}`,
          description: `These look like the same service. If one is stale, canceling it saves ${formatCents(monthlyCents(active[j].amountCents, active[j].billingCycle))}/mo.`,
          severity: "warning",
          subscriptionIds: [active[i].id, active[j].id],
        });
      }
    }
  }
  const byCategoryCount = new Map<Subscription["category"], Subscription[]>();
  for (const s of active) {
    byCategoryCount.set(s.category, [...(byCategoryCount.get(s.category) ?? []), s]);
  }
  for (const [category, subs] of byCategoryCount) {
    if (subs.length >= 2) {
      const combined = subs.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
      insights.push({
        type: "possible_overlap",
        title: `${subs.length} active ${CATEGORY_LABELS[category].toLowerCase()} subscriptions`,
        description: `${subs.map((s) => s.name).join(", ")} — ${formatCents(combined)}/mo combined. Worth checking for overlap.`,
        severity: "info",
        subscriptionIds: subs.map((s) => s.id),
      });
    }
  }

  return insights;
}
