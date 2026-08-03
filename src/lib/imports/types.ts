import type { Subscription } from "@/lib/db/schema";

// A provider's output shape — deliberately source-agnostic. A CSV row, an
// Apple export line, and a future live Plaid transaction all normalize down
// to this same shape before anything downstream (detection, review UI) ever
// sees them, so none of that code needs to know or care which source it
// came from.
export interface RawTransaction {
  date: string; // ISO YYYY-MM-DD
  description: string; // raw merchant/description text, pre-normalization
  amountCents: number; // always positive; sign/direction is separate
  direction: "debit" | "credit";
  currency: string; // lowercase 3-letter, defaulted per-provider if absent
  reference?: string;
}

export interface ImportParseResult {
  transactions: RawTransaction[];
  warnings: string[];
  skippedRowCount: number;
}

export interface MerchantMatch {
  displayName: string;
  category: Subscription["category"];
  isKnownSubscriptionMerchant: boolean;
}

export type Confidence = "high" | "medium" | "low";

export type ConfidenceSignal =
  | "known_subscription_merchant"
  | "consistent_amount"
  | "consistent_interval"
  | "multiple_months"
  | "irregular_amount"
  | "irregular_interval";

export interface BillingCycleEstimate {
  cycle: Subscription["billingCycle"];
  averageIntervalDays: number;
  intervalVarianceDays: number;
}

export interface DetectedSubscription {
  // Stable within one analyze response — lets the review UI track
  // selection/edits by id without relying on array index.
  id: string;
  merchant: MerchantMatch;
  transactions: RawTransaction[];
  amountCents: number;
  amountVariancePct: number;
  estimatedBillingCycle: BillingCycleEstimate;
  monthsSeen: number;
  confidence: Confidence;
  confidenceSignals: ConfidenceSignal[];
  suggestedNextRenewalDate: string;
  isDuplicateOfExistingId?: string;
}
