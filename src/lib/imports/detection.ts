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

const CYCLE_BUCKETS: CycleBucket[] = [
  { cycle: "weekly", targetDays: 7, toleranceDays: 3 },
  { cycle: "monthly", targetDays: 30, toleranceDays: 5 },
  { cycle: "quarterly", targetDays: 91, toleranceDays: 10 },
  { cycle: "yearly", targetDays: 365, toleranceDays: 20 },
];

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
    const consistentInterval = estimatedBillingCycle.intervalVarianceDays <= bucket.toleranceDays;

    const amounts = sorted.map((t) => t.amountCents);
    const representativeAmount = median(amounts);
    const amountVariancePct =
      representativeAmount > 0 ? (Math.max(...amounts) - Math.min(...amounts)) / representativeAmount : 0;
    const consistentAmount = amountVariancePct <= CONSISTENT_AMOUNT_MAX_VARIANCE_PCT;

    const monthsSeen = new Set(sorted.map((t) => t.date.slice(0, 7))).size;
    const multipleMonths = monthsSeen >= MULTIPLE_MONTHS_THRESHOLD;

    const signals: ConfidenceSignal[] = [];
    if (merchant.isKnownSubscriptionMerchant) signals.push("known_subscription_merchant");
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
