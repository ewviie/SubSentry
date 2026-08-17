import type { Subscription } from "@/lib/db/schema";
import { monthlyCents } from "@/lib/subscriptions/money";
import { normalizeName, namesLikelyMatch } from "@/lib/subscriptions/insights";
import type { EngineContext } from "./types";

// Pure, side-effect-free computations shared by health/free/premium rules —
// each signal is computed once per rule that needs it (rules are cheap and
// this runs client-request-scoped, not hot-loop), keeping every rule file a
// thin "compute signal, format InsightResult" wrapper instead of
// re-deriving detection logic per rule.

export function monthlyTotalCents(active: Subscription[]): number {
  return active.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
}

export interface DuplicatePair {
  keep: Subscription;
  redundant: Subscription;
  monthlySavingsCents: number;
}

// Same identity rule as savings.ts/insights.ts: the second (later-indexed)
// half of a matching pair is the redundant one — reused here instead of
// re-imported from savings.ts to keep this module dependency-free of the
// standalone /savings page's own presentation-oriented types.
export function findDuplicates(active: Subscription[]): DuplicatePair[] {
  const normalized = active.map((s) => normalizeName(s.name));
  const pairs: DuplicatePair[] = [];
  const seenRedundant = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (!namesLikelyMatch(normalized[i], normalized[j])) continue;
      if (seenRedundant.has(active[j].id)) continue;
      seenRedundant.add(active[j].id);
      pairs.push({
        keep: active[i],
        redundant: active[j],
        monthlySavingsCents: monthlyCents(active[j].amountCents, active[j].billingCycle),
      });
    }
  }
  return pairs;
}

export interface CategoryConcentration {
  category: Subscription["category"];
  cents: number;
  share: number; // 0-1 of monthlyTotal
  subscriptionIds: string[];
}

// Returns the single biggest category's share of spend, or null when spend
// is zero or everything is already in one category (nothing to "balance").
export function categoryConcentration(active: Subscription[]): CategoryConcentration | null {
  const total = monthlyTotalCents(active);
  if (total === 0) return null;
  const byCategory = new Map<Subscription["category"], { cents: number; ids: string[] }>();
  for (const s of active) {
    const entry = byCategory.get(s.category) ?? { cents: 0, ids: [] };
    entry.cents += monthlyCents(s.amountCents, s.billingCycle);
    entry.ids.push(s.id);
    byCategory.set(s.category, entry);
  }
  if (byCategory.size <= 1) return null;
  const [category, entry] = Array.from(byCategory.entries()).sort((a, b) => b[1].cents - a[1].cents)[0];
  return { category, cents: entry.cents, share: entry.cents / total, subscriptionIds: entry.ids };
}

export interface RenewalCluster {
  windowStartIso: string;
  subscriptionIds: string[];
  totalCents: number;
}

// Active subscriptions whose next renewal falls within `windowDays` of the
// single busiest anchor date — a real "several bills land the same week"
// signal, not a guess. Returns null when nothing clusters (max cluster < 3).
export function findRenewalCluster(active: Subscription[], todayIso: string, windowDays = 7): RenewalCluster | null {
  const upcoming = active
    .filter((s) => s.nextRenewalDate >= todayIso)
    .sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate));
  if (upcoming.length < 3) return null;

  let best: RenewalCluster | null = null;
  for (let i = 0; i < upcoming.length; i++) {
    const anchor = new Date(`${upcoming[i].nextRenewalDate}T00:00:00Z`);
    const windowEnd = new Date(anchor.getTime() + windowDays * 86_400_000);
    const inWindow = upcoming.filter((s) => {
      const d = new Date(`${s.nextRenewalDate}T00:00:00Z`);
      return d >= anchor && d <= windowEnd;
    });
    if (inWindow.length >= 3 && (!best || inWindow.length > best.subscriptionIds.length)) {
      best = {
        windowStartIso: upcoming[i].nextRenewalDate,
        subscriptionIds: inWindow.map((s) => s.id),
        totalCents: inWindow.reduce((sum, s) => sum + s.amountCents, 0),
      };
    }
  }
  return best;
}

export interface ExpensiveOutlier {
  subscription: Subscription;
  annualCents: number;
}

// Subscriptions costing at least 2x the group's mean annual cost — a
// relative outlier detector that scales with each user's own spend rather
// than a fixed dollar threshold no single currency/cohort would fit.
export function findExpensiveOutliers(active: Subscription[]): ExpensiveOutlier[] {
  if (active.length < 2) return [];
  const annualized = active.map((s) => ({ subscription: s, annualCents: monthlyCents(s.amountCents, s.billingCycle) * 12 }));
  const mean = annualized.reduce((sum, a) => sum + a.annualCents, 0) / annualized.length;
  return annualized
    .filter((a) => a.annualCents >= mean * 2 && a.annualCents >= 3000)
    .sort((a, b) => b.annualCents - a.annualCents);
}

export function longRunningSubscriptions(active: Subscription[], todayIso: string, minDays = 365): Subscription[] {
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  return active.filter((s) => (today - s.createdAt.getTime()) / 86_400_000 >= minDays);
}

// Active subscriptions with no yearly/quarterly billing at all among a
// group large enough that a multi-month plan would plausibly exist —
// informs the "mostly monthly, no annual discount captured" free insight.
export function billingCycleCounts(active: Subscription[]): Record<Subscription["billingCycle"], number> {
  const counts: Record<Subscription["billingCycle"], number> = { monthly: 0, yearly: 0, quarterly: 0, weekly: 0 };
  for (const s of active) counts[s.billingCycle] += 1;
  return counts;
}

// Net new active-subscription count added in the last `days` — reuses each
// subscription's own createdAt, the same real signal analytics.ts's
// computeGrowthOverTime buckets by, rather than a synthetic "trend" figure.
export function recentGrowthCount(active: Subscription[], todayIso: string, days = 30): number {
  const cutoff = new Date(`${todayIso}T00:00:00Z`).getTime() - days * 86_400_000;
  return active.filter((s) => s.createdAt.getTime() >= cutoff).length;
}

export function upcomingRenewalTotalCents(active: Subscription[], todayIso: string, days = 30): number {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const end = new Date(today.getTime() + days * 86_400_000);
  return active
    .filter((s) => {
      const d = new Date(`${s.nextRenewalDate}T00:00:00Z`);
      return d >= today && d <= end;
    })
    .reduce((sum, s) => sum + s.amountCents, 0);
}

export function canceledCount(all: Subscription[]): number {
  return all.filter((s) => s.status === "canceled").length;
}

// An active subscription whose renewal date has already passed — real
// bookkeeping neglect (the date was never updated after a renewal, or the
// service was actually canceled elsewhere and SubSentry was never told),
// not a guess about usage this app has no data to support.
export function overdueRenewals(active: Subscription[], todayIso: string): Subscription[] {
  return active.filter((s) => s.nextRenewalDate < todayIso);
}

// category="other" is the schema's default (see schema.ts) and, for a
// *manually* entered subscription, can be a genuine, deliberate choice —
// not every subscription fits streaming/software/fitness/etc., and a user
// picking "Other" themselves isn't a data-quality problem. For an
// *imported* row (csv_import, ai_parsed, apple_import, ...), "other" means
// something different: the classifier that ran over it (merchant-
// normalizer.ts's KNOWN_MERCHANTS table) didn't recognize the merchant at
// all, so the category is really "unknown," not "deliberately other." This
// only counts that second, honest-gap case — see health.ts's
// uncategorizedImports rule for why that distinction matters.
export function uncategorizedImports(active: Subscription[]): Subscription[] {
  return active.filter((s) => s.category === "other" && s.source !== "manual");
}

export const ctxTotal = (ctx: EngineContext) => monthlyTotalCents(ctx.active);
