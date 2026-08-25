import { describe, it, expect } from "vitest";
import { detectedToFormValues, isPreselectedByDefault } from "./review-table";
import type { DetectedSubscription } from "@/lib/imports/types";

// This project has no React component-rendering test setup (no
// testing-library/jsdom dependency, no other *.test.tsx anywhere under
// src/components). detectedToFormValues is a plain function, so it's
// tested directly here rather than introducing a new testing paradigm for
// one function.

function makeDetected(overrides: Partial<DetectedSubscription> = {}): DetectedSubscription {
  return {
    id: "d1",
    merchant: { displayName: "Netflix", category: "streaming", isKnownSubscriptionMerchant: true },
    transactions: [
      { date: "2026-01-01", description: "Netflix", amountCents: 1599, direction: "debit", currency: "usd" },
    ],
    amountCents: 1599,
    amountVariancePct: 0,
    estimatedBillingCycle: { cycle: "monthly", averageIntervalDays: 30, intervalVarianceDays: 1 },
    monthsSeen: 3,
    confidence: "high",
    confidenceSignals: [],
    suggestedNextRenewalDate: "2026-02-01",
    ...overrides,
  };
}

describe("detectedToFormValues", () => {
  it("maps a detected subscription's fields onto form values", () => {
    const result = detectedToFormValues(makeDetected());
    expect(result).toMatchObject({
      name: "Netflix",
      amount: "15.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2026-02-01",
      status: "active",
      notes: "",
    });
  });

  // Regression: normalizeMerchant() deliberately does NOT truncate
  // displayName (see merchant-normalizer.ts's own comment: it's also
  // detection.ts's clustering key, and truncating it there would collide
  // unrelated long descriptions onto the same cluster). The length cap
  // belongs here instead, at the one point this becomes a submitted
  // subscription name. This is the only place that actually enforces it,
  // so it needs its own direct test now that it moved out of
  // merchant-normalizer.ts.
  it("truncates an over-long merchant display name to the subscription name limit", () => {
    const longName = "A".repeat(200);
    const result = detectedToFormValues(
      makeDetected({ merchant: { displayName: longName, category: "other", isKnownSubscriptionMerchant: false } }),
    );
    expect(result.name.length).toBe(120);
    expect(result.name).toBe(longName.slice(0, 120));
  });

  it("does not alter a merchant display name already within the limit", () => {
    const result = detectedToFormValues(makeDetected());
    expect(result.name).toBe("Netflix");
  });

  it("defaults currency to usd when the detected transaction has none", () => {
    const result = detectedToFormValues(makeDetected({ transactions: [] }));
    expect(result.currency).toBe("usd");
  });
});

// Regression coverage for a Phase 7 fix: detectRecurringSubscriptions()
// (lib/imports/detection.ts) already computes isDuplicateOfExistingId, but
// nothing consulted it when deciding what to pre-select. A high-confidence
// duplicate of an existing subscription got checked by default and could be
// silently re-imported as a second, real, recurring charge.
describe("isPreselectedByDefault", () => {
  it("pre-selects a high-confidence row with no duplicate match", () => {
    expect(isPreselectedByDefault(makeDetected({ confidence: "high" }))).toBe(true);
  });

  it("does not pre-select a high-confidence row that matches an existing subscription", () => {
    expect(
      isPreselectedByDefault(makeDetected({ confidence: "high", isDuplicateOfExistingId: "existing-sub-1" })),
    ).toBe(false);
  });

  it("does not pre-select a medium/low-confidence row regardless of duplicate status", () => {
    expect(isPreselectedByDefault(makeDetected({ confidence: "medium" }))).toBe(false);
    expect(isPreselectedByDefault(makeDetected({ confidence: "low" }))).toBe(false);
  });

  // A row carrying a price-change proposal always also carries
  // isDuplicateOfExistingId (detection.ts only ever attaches one alongside
  // the other), asserted directly here so this stays true even if that
  // invariant ever drifts, since a pre-selected price-change row would mean
  // "Confirm" both updates the existing subscription's price AND creates a
  // second, duplicate one for the same charge.
  it("does not pre-select a row carrying a price-change proposal", () => {
    expect(
      isPreselectedByDefault(
        makeDetected({
          confidence: "high",
          isDuplicateOfExistingId: "existing-sub-1",
          priceChangeProposal: {
            existingSubscriptionId: "existing-sub-1",
            existingName: "Netflix",
            existingAmountCents: 1599,
            existingBillingCycle: "monthly",
            currency: "usd",
            detectedAmountCents: 1999,
            detectedBillingCycle: "monthly",
            percentChange: 25,
            annualDeltaCents: 4800,
          },
        }),
      ),
    ).toBe(false);
  });
});
