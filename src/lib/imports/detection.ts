import { levenshtein, normalizeName } from "@/lib/subscriptions/insights";
import type { Subscription } from "@/lib/db/schema";
import { normalizeMerchant } from "./merchant-normalizer";
import type {
  BillingCycleEstimate,
  Confidence,
  ConfidenceSignal,
  DetectedSubscription,
  RawTransaction,
} from "./types";

// Same UTC-midnight-string pattern used throughout the app (filters.ts,
// subscription-form.tsx's todayISO()) to avoid local-timezone drift when
// diffing two ISO date strings.
function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  const aMs = new Date(`${a}T00:00:00Z`).getTime();
  const bMs = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((bMs - aMs) / msPerDay);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

interface CycleBucket {
  cycle: Subscription["billingCycle"];
  targetDays: number;
  toleranceDays: number;
}

// Quarterly and yearly tolerances are wider than a naive scaling of
// weekly/monthly's would suggest — real-world annual/quarterly billing
// drifts more in absolute days than shorter cadences do (a renewal landing
// on a weekend/holiday, a processor retry, a leap year) without that drift
// meaning the charge isn't the same subscription.
const CYCLE_BUCKETS: CycleBucket[] = [
  { cycle: "weekly", targetDays: 7, toleranceDays: 3 },
  { cycle: "monthly", targetDays: 30, toleranceDays: 5 },
  { cycle: "quarterly", targetDays: 91, toleranceDays: 12 },
  { cycle: "yearly", targetDays: 365, toleranceDays: 30 },
];

// Below the shortest defined cadence's plausible range — two charges from
// the same merchant a couple of days apart are far more likely to be
// unrelated one-off purchases (two different Amazon orders, two trips to
// the same coffee shop) than a genuine sub-weekly subscription. Without
// this floor, a 2-occurrence cluster's "interval variance" is a population
// stddev over a single gap, which is trivially 0 regardless of how
// implausible that gap is — this is the actual bug the floor fixes, not
// just a stricter policy choice.
const MIN_PLAUSIBLE_GAP_DAYS = 4;

function estimateBillingCycle(gapDays: number[]): BillingCycleEstimate {
  const meanGap = gapDays.reduce((sum, g) => sum + g, 0) / gapDays.length;
  const nearest = CYCLE_BUCKETS.reduce((best, bucket) =>
    Math.abs(meanGap - bucket.targetDays) < Math.abs(meanGap - best.targetDays) ? bucket : best,
  );
  return {
    cycle: nearest.cycle,
    averageIntervalDays: Math.round(meanGap),
    intervalVarianceDays: Math.round(populationStdDev(gapDays)),
  };
}

// Each gap is judged against the bucket's own canonical target, not the
// empirical mean/median of the observed gaps — comparing gaps to each
// other (as the old population-stddev check effectively did) is trivially
// "consistent" with a single gap (n=1 has zero variance by definition,
// regardless of how implausible that one gap is) and is fooled by a
// systematic drift that's still internally uniform. With 3+ gaps, at most
// one is allowed to fall outside tolerance — a single skipped or
// retried billing period (e.g. gaps of [30, 30, 62, 30]) shouldn't tank an
// otherwise-clean pattern, which is exactly the "irregular billing
// intervals" case a strict all-gaps-must-match rule handles badly.
function isIntervalConsistent(gapDays: number[], bucket: CycleBucket): boolean {
  if (gapDays.length === 1) {
    return gapDays[0] >= MIN_PLAUSIBLE_GAP_DAYS && Math.abs(gapDays[0] - bucket.targetDays) <= bucket.toleranceDays;
  }
  const withinTolerance = gapDays.filter((g) => Math.abs(g - bucket.targetDays) <= bucket.toleranceDays).length;
  const maxOutliers = gapDays.length >= 3 ? 1 : 0;
  return withinTolerance >= gapDays.length - maxOutliers;
}

// Same fuzzy-match idea as insights.ts's namesLikelyMatch (exact match,
// then substring containment for longer names, then a tight edit-distance
// fallback) — reimplemented locally rather than imported, since it's a
// three-line function and importing a private-shaped helper for it would
// be more indirection than the logic warrants; the shared primitives
// (levenshtein, normalizeName) ARE imported rather than duplicated.
function likelyMatchesExistingName(normalizedDetected: string, normalizedExisting: string): boolean {
  if (!normalizedDetected || !normalizedExisting) return false;
  if (normalizedDetected === normalizedExisting) return true;
  if (
    normalizedDetected.length >= 4 &&
    normalizedExisting.length >= 4 &&
    (normalizedDetected.includes(normalizedExisting) || normalizedExisting.includes(normalizedDetected))
  ) {
    return true;
  }
  if (Math.abs(normalizedDetected.length - normalizedExisting.length) > 2) return false;
  return levenshtein(normalizedDetected, normalizedExisting) <= 2;
}

const CONSISTENT_AMOUNT_MAX_VARIANCE_PCT = 0.15;
const MULTIPLE_MONTHS_THRESHOLD = 3;
// The earliest charge counts as a plausible intro/trial price when it's no
// more than 70% of the steady-state (post-intro) median — comfortably below
// the ordinary price-rise noise CONSISTENT_AMOUNT_MAX_VARIANCE_PCT already
// tolerates, so a real intro discount doesn't get misread from a merely
// slightly-cheaper first invoice (a partial-period proration, say).
const INTRO_PRICE_MAX_RATIO = 0.7;
// Below this, two occurrences alone can't distinguish "intro price then
// real price" from "two unrelated amounts" — a steady-state median needs at
// least 2 post-intro charges to mean anything.
const MIN_OCCURRENCES_FOR_INTRO_DETECTION = 3;

interface AmountConsistency {
  representativeAmount: number;
  amountVariancePct: number;
  consistentAmount: boolean;
  introPricingDetected: boolean;
}

// Free-trial-to-paid and introductory-pricing transitions are the same
// underlying shape: one anomalously low first charge followed by a steady
// price. (A literal $0 trial charge never reaches here at all — csv-parser.ts
// drops zero-amount rows upstream — so in practice this is always "first
// real charge is discounted, then the regular price kicks in".) Judging
// amount consistency over the *whole* cluster would read that discount as
// "irregular_amount" and undercount the real ongoing price; recomputing
// over just the steady-state charges fixes both.
function evaluateAmountConsistency(sortedByDate: RawTransaction[]): AmountConsistency {
  const amounts = sortedByDate.map((t) => t.amountCents);
  const wholeClusterVariance = (values: number[]): { representative: number; variancePct: number } => {
    const representative = median(values);
    const variancePct = representative > 0 ? (Math.max(...values) - Math.min(...values)) / representative : 0;
    return { representative, variancePct };
  };

  if (amounts.length >= MIN_OCCURRENCES_FOR_INTRO_DETECTION) {
    const [first, ...rest] = amounts;
    const restMedian = median(rest);
    if (restMedian > 0 && first <= restMedian * INTRO_PRICE_MAX_RATIO) {
      const { representative, variancePct } = wholeClusterVariance(rest);
      return {
        representativeAmount: representative,
        amountVariancePct: variancePct,
        consistentAmount: variancePct <= CONSISTENT_AMOUNT_MAX_VARIANCE_PCT,
        introPricingDetected: true,
      };
    }
  }

  const { representative, variancePct } = wholeClusterVariance(amounts);
  return {
    representativeAmount: representative,
    amountVariancePct: variancePct,
    consistentAmount: variancePct <= CONSISTENT_AMOUNT_MAX_VARIANCE_PCT,
    introPricingDetected: false,
  };
}

export function detectRecurringSubscriptions(
  transactions: RawTransaction[],
  existingSubscriptions: Subscription[],
): DetectedSubscription[] {
  const debits = transactions.filter((t) => t.direction === "debit");

  const clusters = new Map<string, RawTransaction[]>();
  for (const transaction of debits) {
    const merchant = normalizeMerchant(transaction.description);
    const existing = clusters.get(merchant.displayName);
    if (existing) existing.push(transaction);
    else clusters.set(merchant.displayName, [transaction]);
  }

  const existingNormalizedNames = existingSubscriptions.map((s) => ({
    id: s.id,
    normalized: normalizeName(s.name),
  }));

  const detected: DetectedSubscription[] = [];

  for (const [, clusterTransactions] of clusters) {
    // A single charge is never a "detected subscription" candidate at all —
    // never assume every payment is a subscription.
    if (clusterTransactions.length < 2) continue;

    const sorted = [...clusterTransactions].sort((a, b) => a.date.localeCompare(b.date));
    const merchant = normalizeMerchant(sorted[0].description);

    const gapDays: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gapDays.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }
    const estimatedBillingCycle = estimateBillingCycle(gapDays);
    const bucket = CYCLE_BUCKETS.find((b) => b.cycle === estimatedBillingCycle.cycle)!;
    const consistentInterval = isIntervalConsistent(gapDays, bucket);

    const { representativeAmount, amountVariancePct, consistentAmount, introPricingDetected } =
      evaluateAmountConsistency(sorted);

    const monthsSeen = new Set(sorted.map((t) => t.date.slice(0, 7))).size;
    const multipleMonths = monthsSeen >= MULTIPLE_MONTHS_THRESHOLD;

    const signals: ConfidenceSignal[] = [];
    if (merchant.isKnownSubscriptionMerchant) signals.push("known_subscription_merchant");
    if (introPricingDetected) signals.push("introductory_pricing_detected");
    if (consistentAmount) signals.push("consistent_amount");
    else signals.push("irregular_amount");
    if (consistentInterval) signals.push("consistent_interval");
    else signals.push("irregular_interval");
    if (multipleMonths) signals.push("multiple_months");

    const behavioralSignalCount = [consistentAmount, consistentInterval, multipleMonths].filter(Boolean).length;

    // A known-subscription-merchant match is treated as sufficient for High
    // on its own, even at just the 2-occurrence floor — a well-known
    // service appearing twice is already a strong signal, and gating it
    // behind occurrence count in addition would mean a returning Netflix
    // subscriber's first review screen shows it as merely Medium confidence
    // for no real reason. Otherwise, High requires all three independent
    // behavioral signals to agree.
    let confidence: Confidence;
    if (merchant.isKnownSubscriptionMerchant || behavioralSignalCount === 3) {
      confidence = "high";
    } else if (behavioralSignalCount === 2) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    const lastTransactionDate = sorted[sorted.length - 1].date;
    const suggestedNextRenewalDate = addDays(lastTransactionDate, estimatedBillingCycle.averageIntervalDays);

    const normalizedDetectedName = normalizeName(merchant.displayName);
    const duplicateMatch = existingNormalizedNames.find((existing) =>
      likelyMatchesExistingName(normalizedDetectedName, existing.normalized),
    );

    detected.push({
      id: crypto.randomUUID(),
      merchant,
      transactions: sorted,
      amountCents: representativeAmount,
      amountVariancePct,
      estimatedBillingCycle,
      monthsSeen,
      confidence,
      confidenceSignals: signals,
      suggestedNextRenewalDate,
      isDuplicateOfExistingId: duplicateMatch?.id,
    });
  }

  return detected;
}

function addDays(iso: string, days: number): string {
  const ms = new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
