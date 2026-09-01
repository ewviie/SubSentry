import { describe, it, expect } from "vitest";
import { detectRecurringSubscriptions } from "./detection";
import type { RawTransaction } from "./types";
import type { Subscription } from "@/lib/db/schema";

// Computed rather than hand-typed, so test fixtures can't accidentally
// encode an arithmetic mistake in the expected gap between two dates.
function addDaysISO(iso: string, days: number): string {
  const ms = new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function tx(overrides: Partial<RawTransaction>): RawTransaction {
  return {
    date: "2026-01-01",
    description: "Test Merchant",
    amountCents: 999,
    direction: "debit",
    currency: "usd",
    ...overrides,
  };
}

let nextId = 1;
function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: `sub-${nextId++}`,
    userId: "user-1",
    name: "Test Sub",
    amountCents: 999,
    currency: "usd",
    billingCycle: "monthly",
    category: "other",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    lastReviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("detectRecurringSubscriptions", () => {
  it("never surfaces a single occurrence as a candidate at all", () => {
    const detected = detectRecurringSubscriptions([tx({ description: "RANDOM STORE" })], []);
    expect(detected).toHaveLength(0);
  });

  it("flags a known merchant as high confidence even with only the 2-occurrence floor", () => {
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1599 }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 31), amountCents: 1599 }),
      ],
      [],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].confidence).toBe("high");
    expect(detected[0].confidenceSignals).toContain("known_subscription_merchant");
    expect(detected[0].merchant.displayName).toBe("Netflix");
  });

  it("flags an unknown merchant as high confidence when all three behavioral signals agree", () => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 31);
    const d3 = addDaysISO(d2, 28);
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "LOCAL GYM MEMBERSHIP", date: d1, amountCents: 4500 }),
        tx({ description: "LOCAL GYM MEMBERSHIP", date: d2, amountCents: 4500 }),
        tx({ description: "LOCAL GYM MEMBERSHIP", date: d3, amountCents: 4500 }),
      ],
      [],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].confidence).toBe("high");
    expect(detected[0].merchant.isKnownSubscriptionMerchant).toBe(false);
    expect(detected[0].confidenceSignals).toEqual(
      expect.arrayContaining(["consistent_amount", "consistent_interval", "multiple_months"]),
    );
  });

  it("scores an unknown merchant with only 2 of 3 behavioral signals as medium", () => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 30);
    // Consistent amount and interval, but only 2 distinct months seen —
    // multiple_months requires 3.
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "LOCAL GYM MEMBERSHIP", date: d1, amountCents: 4500 }),
        tx({ description: "LOCAL GYM MEMBERSHIP", date: d2, amountCents: 4500 }),
      ],
      [],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].confidence).toBe("medium");
  });

  it("stays low for an unknown merchant with wildly irregular amounts and intervals, even with 4+ occurrences", () => {
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "RANDOM STORE", date: "2026-01-01", amountCents: 500 }),
        tx({ description: "RANDOM STORE", date: "2026-01-15", amountCents: 5000 }),
        tx({ description: "RANDOM STORE", date: "2026-03-20", amountCents: 100 }),
        tx({ description: "RANDOM STORE", date: "2026-03-25", amountCents: 3000 }),
      ],
      [],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].confidence).toBe("low");
    expect(detected[0].confidenceSignals).toContain("irregular_amount");
    expect(detected[0].confidenceSignals).toContain("irregular_interval");
  });

  it("only considers debit transactions — a matching pair of credits never clusters", () => {
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "REFUND CO", date: "2026-01-01", direction: "credit" }),
        tx({ description: "REFUND CO", date: "2026-02-01", direction: "credit" }),
      ],
      [],
    );
    expect(detected).toHaveLength(0);
  });

  it("flags a detected cluster as a duplicate of an existing subscription with a matching name", () => {
    const existing = sub({ name: "Netflix" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01" }),
        tx({ description: "NETFLIX.COM", date: "2026-02-01" }),
      ],
      [existing],
    );
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
  });

  it("does not flag a cluster as a duplicate when no existing subscription matches", () => {
    const existing = sub({ name: "Spotify" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01" }),
        tx({ description: "NETFLIX.COM", date: "2026-02-01" }),
      ],
      [existing],
    );
    expect(detected[0].isDuplicateOfExistingId).toBeUndefined();
  });

  // Regression: listSubscriptions() (the caller's data source) returns
  // every status, not just active — a name match against a canceled or
  // paused existing row is far more likely a legitimate resubscription
  // (exactly what a bank-sync import should catch) than an accidental
  // duplicate of something still being paid for. Phase 7 made this flag
  // directly consequential (review-table.tsx uses it to change default
  // selection and show a warning badge), so a false positive here now
  // actively nudges a user away from correctly re-tracking a real charge.
  it.each(["canceled", "paused"] as const)(
    "does not flag a cluster as a duplicate of a %s existing subscription",
    (status) => {
      const existing = sub({ name: "Netflix", status });
      const detected = detectRecurringSubscriptions(
        [
          tx({ description: "NETFLIX.COM", date: "2026-01-01" }),
          tx({ description: "NETFLIX.COM", date: "2026-02-01" }),
        ],
        [existing],
      );
      expect(detected[0].isDuplicateOfExistingId).toBeUndefined();
    },
  );

  it.each([
    ["weekly", 7],
    ["monthly", 30],
    ["quarterly", 91],
    ["yearly", 365],
  ] as const)("infers a %s billing cycle from consistent %d-day gaps", (expectedCycle, gapDays) => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, gapDays);
    const d3 = addDaysISO(d2, gapDays);
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "REGULAR CHARGE CO", date: d1 }),
        tx({ description: "REGULAR CHARGE CO", date: d2 }),
        tx({ description: "REGULAR CHARGE CO", date: d3 }),
      ],
      [],
    );
    expect(detected[0].estimatedBillingCycle.cycle).toBe(expectedCycle);
  });
});

describe("price-change proposal (import reconciliation)", () => {
  it("strong match + price increase: proposes an update with the correct signed percent/dollar delta", () => {
    const existing = sub({ name: "Netflix", amountCents: 1599, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1999 }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 31), amountCents: 1999 }),
      ],
      [existing],
    );
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
    const proposal = detected[0].priceChangeProposal;
    expect(proposal).toBeDefined();
    expect(proposal!.existingSubscriptionId).toBe(existing.id);
    expect(proposal!.existingAmountCents).toBe(1599);
    expect(proposal!.detectedAmountCents).toBe(1999);
    expect(proposal!.percentChange).toBeGreaterThan(0);
    expect(proposal!.annualDeltaCents).toBe((1999 - 1599) * 12);
  });

  it("strong match + price decrease: proposes an update with a negative percent change", () => {
    const existing = sub({ name: "Netflix", amountCents: 1999, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1599 }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 31), amountCents: 1599 }),
      ],
      [existing],
    );
    const proposal = detected[0].priceChangeProposal;
    expect(proposal).toBeDefined();
    expect(proposal!.percentChange).toBeLessThan(0);
  });

  it("exact same price: still a duplicate, but no price-change proposal", () => {
    const existing = sub({ name: "Netflix", amountCents: 1599, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1599 }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 31), amountCents: 1599 }),
      ],
      [existing],
    );
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
    expect(detected[0].priceChangeProposal).toBeUndefined();
  });

  it("weak match: a low-confidence cluster never gets a price-change proposal, even against a name match with a different amount", () => {
    const existing = sub({ name: "Random Store", amountCents: 500, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "RANDOM STORE", date: "2026-01-01", amountCents: 500 }),
        tx({ description: "RANDOM STORE", date: "2026-01-15", amountCents: 5000 }),
        tx({ description: "RANDOM STORE", date: "2026-03-20", amountCents: 100 }),
        tx({ description: "RANDOM STORE", date: "2026-03-25", amountCents: 3000 }),
      ],
      [existing],
    );
    expect(detected[0].confidence).toBe("low");
    // Still flagged as a plain duplicate (name-match alone doesn't need
    // confidence gating) — only the more assertive price-change proposal
    // requires it.
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
    expect(detected[0].priceChangeProposal).toBeUndefined();
  });

  it("currency mismatch: a strong name match with a different transaction currency never proposes a price change", () => {
    const existing = sub({ name: "Netflix", amountCents: 1599, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1999, currency: "eur" }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 31), amountCents: 1999, currency: "eur" }),
      ],
      [existing],
    );
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
    expect(detected[0].priceChangeProposal).toBeUndefined();
  });

  it("billing-cycle mismatch: compares monthly-equivalents correctly, not raw amounts, and reports each side's own cycle", () => {
    // Existing tracked as $15.99/mo; the bank now shows a quarterly charge
    // of $59.97 (== $19.99/mo) — a real ~25% increase, not the ~275% a raw
    // amountCents comparison ($59.97 vs $15.99) would suggest.
    const existing = sub({ name: "Netflix", amountCents: 1599, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 5997 }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 91), amountCents: 5997 }),
      ],
      [existing],
    );
    expect(detected[0].estimatedBillingCycle.cycle).toBe("quarterly");
    const proposal = detected[0].priceChangeProposal;
    expect(proposal).toBeDefined();
    expect(proposal!.existingBillingCycle).toBe("monthly");
    expect(proposal!.detectedBillingCycle).toBe("quarterly");
    expect(proposal!.percentChange).toBeGreaterThan(0);
    expect(proposal!.percentChange).toBeLessThan(50); // real ~25%, not a raw-amount artifact
  });

  it("promo/one-off: proposes a change based on the steady-state price, not a discounted intro charge", () => {
    // Existing already tracked at the real steady-state price ($19.99) —
    // the discounted first charge ($4.99, an intro offer) must not be read
    // as a price *decrease* against it.
    const existing = sub({ name: "Streamer Plus", amountCents: 1999, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMER PLUS", date: "2026-01-01", amountCents: 499 }),
        tx({ description: "STREAMER PLUS", date: addDaysISO("2026-01-01", 30), amountCents: 1999 }),
        tx({ description: "STREAMER PLUS", date: addDaysISO("2026-01-01", 60), amountCents: 1999 }),
      ],
      [existing],
    );
    expect(detected[0].confidenceSignals).toContain("introductory_pricing_detected");
    expect(detected[0].amountCents).toBe(1999); // steady-state, not the $4.99 intro charge
    expect(detected[0].priceChangeProposal).toBeUndefined(); // matches existing exactly once intro is excluded
  });

  // Regression (product council review, Devil's Advocate lens): the old
  // .find() picked whichever existing subscription happened to come first
  // in array order (real callers order by next renewal date — a field with
  // no relationship to name-match quality), not the best match. A base
  // plan's name is very often a clean substring of its own bundle/family
  // variant ("Streamflix Plus" inside "Streamflix Plus Family"), so a
  // looser fuzzy match could silently win over an exact one sitting later
  // in the array — proposing (and letting the user one-click-confirm) a
  // price update against the WRONG subscription.
  it("prefers an exact name match over a fuzzy one, regardless of array order", () => {
    const bundle = sub({ name: "Streamflix Plus Family", amountCents: 2999, billingCycle: "monthly", currency: "usd" });
    const exact = sub({ name: "Streamflix Plus", amountCents: 1599, billingCycle: "monthly", currency: "usd" });
    // Bundle listed first — simulates it sorting earlier (e.g. by an
    // earlier next-renewal-date) than the real exact match.
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMFLIX PLUS", date: "2026-01-01", amountCents: 1999 }),
        tx({ description: "STREAMFLIX PLUS", date: addDaysISO("2026-01-01", 30), amountCents: 1999 }),
      ],
      [bundle, exact],
    );
    expect(detected[0].isDuplicateOfExistingId).toBe(exact.id);
    const proposal = detected[0].priceChangeProposal;
    expect(proposal).toBeDefined();
    expect(proposal!.existingSubscriptionId).toBe(exact.id);
    expect(proposal!.existingAmountCents).toBe(1599);
  });

  // The genuinely ambiguous case: no single exact winner, 2+ subscriptions
  // fuzzy-match the same cluster. Still flagged as a plain duplicate (an
  // existing, non-destructive badge), but must never propose overwriting
  // one specific subscription's price when it's actually unclear which one
  // is the real match.
  it("does not propose a price change when two existing subscriptions both fuzzy-match, with no exact winner", () => {
    const familyA = sub({ name: "Streamflix Plus Family", amountCents: 2999, billingCycle: "monthly", currency: "usd" });
    const familyB = sub({ name: "Streamflix Plus Household", amountCents: 3499, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMFLIX PLUS", date: "2026-01-01", amountCents: 1999 }),
        tx({ description: "STREAMFLIX PLUS", date: addDaysISO("2026-01-01", 30), amountCents: 1999 }),
      ],
      [familyA, familyB],
    );
    expect(detected[0].isDuplicateOfExistingId).toBeDefined();
    expect(detected[0].priceChangeProposal).toBeUndefined();
  });

  // Regression (release-review finding #2, superseding a CodeRabbit-review
  // test of the same name): clustering now partitions by [merchant,
  // currency] before this point (see "currency partitioning" describe
  // block below), so a detected cluster's own transactions can no longer
  // mix currencies at all. What's still a real, live risk is a detected
  // cluster (single-currency by construction) matching, by name, an
  // existing subscription stored in a *different* currency —
  // computePriceChangeIfMeaningful (price-history.ts) is the guard that
  // must reject that pairing rather than comparing raw cents across
  // currencies.
  it("never proposes a price change when the existing subscription's currency differs from the detected cluster's own currency", () => {
    const existing = sub({ name: "Netflix", amountCents: 1599, billingCycle: "monthly", currency: "usd" });
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1799, currency: "eur" }),
        tx({ description: "NETFLIX.COM", date: addDaysISO("2026-01-01", 31), amountCents: 1799, currency: "eur" }),
      ],
      [existing],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
    expect(detected[0].priceChangeProposal).toBeUndefined();
  });
});

describe("introductory pricing / free-trial transitions", () => {
  it("treats a discounted first charge followed by a steady price as high confidence, not irregular_amount", () => {
    // 31-day gaps (not 30) so each charge reliably lands in a new calendar
    // month regardless of which month d1 starts in — multiple_months needs
    // 3 distinct months, and Jan 1 + 30 days is still January.
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 31);
    const d3 = addDaysISO(d2, 31);
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMING CO", date: d1, amountCents: 199 }), // $1.99 intro
        tx({ description: "STREAMING CO", date: d2, amountCents: 1499 }), // $14.99 regular
        tx({ description: "STREAMING CO", date: d3, amountCents: 1499 }),
      ],
      [],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].confidenceSignals).toContain("introductory_pricing_detected");
    expect(detected[0].confidenceSignals).not.toContain("irregular_amount");
    expect(detected[0].confidence).toBe("high");
  });

  it("reports the steady-state price as the representative amount, not a median skewed by the intro charge", () => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 30);
    const d3 = addDaysISO(d2, 30);
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMING CO", date: d1, amountCents: 199 }),
        tx({ description: "STREAMING CO", date: d2, amountCents: 1499 }),
        tx({ description: "STREAMING CO", date: d3, amountCents: 1499 }),
      ],
      [],
    );
    expect(detected[0].amountCents).toBe(1499);
  });

  it("does not misread an ordinary price increase (not a steep intro discount) as introductory pricing", () => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 30);
    const d3 = addDaysISO(d2, 30);
    // First charge is 90% of the later price — a plausible small price
    // change, not a >=30%-off intro discount.
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMING CO", date: d1, amountCents: 900 }),
        tx({ description: "STREAMING CO", date: d2, amountCents: 1000 }),
        tx({ description: "STREAMING CO", date: d3, amountCents: 1000 }),
      ],
      [],
    );
    expect(detected[0].confidenceSignals).not.toContain("introductory_pricing_detected");
  });

  it("does not attempt intro-pricing detection with only 2 occurrences", () => {
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "STREAMING CO", date: "2026-01-01", amountCents: 199 }),
        tx({ description: "STREAMING CO", date: addDaysISO("2026-01-01", 30), amountCents: 1499 }),
      ],
      [],
    );
    expect(detected[0].confidenceSignals).not.toContain("introductory_pricing_detected");
  });
});

describe("irregular billing intervals (skipped/retried periods)", () => {
  it("tolerates a single doubled gap among an otherwise-consistent monthly pattern", () => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 30);
    const d3 = addDaysISO(d2, 62); // a missed month, billed on the retry
    const d4 = addDaysISO(d3, 30);
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "GYM CO", date: d1, amountCents: 4500 }),
        tx({ description: "GYM CO", date: d2, amountCents: 4500 }),
        tx({ description: "GYM CO", date: d3, amountCents: 4500 }),
        tx({ description: "GYM CO", date: d4, amountCents: 4500 }),
      ],
      [],
    );
    expect(detected[0].confidenceSignals).toContain("consistent_interval");
  });

  it("still flags irregular_interval when more than one gap is inconsistent", () => {
    const d1 = "2026-01-01";
    const d2 = addDaysISO(d1, 30);
    const d3 = addDaysISO(d2, 75); // outlier
    const d4 = addDaysISO(d3, 80); // outlier
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "GYM CO", date: d1, amountCents: 4500 }),
        tx({ description: "GYM CO", date: d2, amountCents: 4500 }),
        tx({ description: "GYM CO", date: d3, amountCents: 4500 }),
        tx({ description: "GYM CO", date: d4, amountCents: 4500 }),
      ],
      [],
    );
    expect(detected[0].confidenceSignals).toContain("irregular_interval");
  });
});

describe("false-positive reduction", () => {
  it("does not treat two charges a couple of days apart as a consistent (weekly) cadence", () => {
    // Two unrelated one-off purchases from the same generic merchant,
    // days apart — not a plausible subscription cadence at all. Before the
    // minimum-gap floor, a single gap's "variance" was trivially zero,
    // always passing as consistent regardless of the gap's size.
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "GENERIC STORE", date: "2026-01-01", amountCents: 2500 }),
        tx({ description: "GENERIC STORE", date: "2026-01-03", amountCents: 2500 }),
      ],
      [],
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].confidenceSignals).toContain("irregular_interval");
    expect(detected[0].confidence).not.toBe("high");
  });

  it("does not treat a single wildly-off gap as consistent with any cadence", () => {
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "GENERIC STORE", date: "2026-01-01", amountCents: 2500 }),
        tx({ description: "GENERIC STORE", date: "2026-01-20", amountCents: 2500 }), // 19 days: not weekly, not monthly
      ],
      [],
    );
    expect(detected[0].confidenceSignals).toContain("irregular_interval");
  });
});

describe("widened quarterly/yearly tolerance", () => {
  it("accepts a yearly subscription with a small amount of real-world date drift", () => {
    const d1 = "2026-01-05";
    const d2 = addDaysISO(d1, 380); // ~15 days beyond a clean 365, e.g. a leap year plus a few days' processing drift
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "ANNUAL PLAN CO", date: d1, amountCents: 9999 }),
        tx({ description: "ANNUAL PLAN CO", date: d2, amountCents: 9999 }),
      ],
      [],
    );
    expect(detected[0].estimatedBillingCycle.cycle).toBe("yearly");
    expect(detected[0].confidenceSignals).toContain("consistent_interval");
  });

  it("accepts a quarterly subscription with a small amount of real-world date drift", () => {
    const d1 = "2026-01-05";
    const d2 = addDaysISO(d1, 100); // ~9 days beyond a clean 91
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "QUARTERLY PLAN CO", date: d1, amountCents: 2999 }),
        tx({ description: "QUARTERLY PLAN CO", date: d2, amountCents: 2999 }),
      ],
      [],
    );
    expect(detected[0].estimatedBillingCycle.cycle).toBe("quarterly");
    expect(detected[0].confidenceSignals).toContain("consistent_interval");
  });

  it("still rejects a yearly gap that drifts well beyond the widened tolerance", () => {
    const d1 = "2026-01-05";
    const d2 = addDaysISO(d1, 440); // 75 days beyond target — implausible drift
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "ANNUAL PLAN CO", date: d1, amountCents: 9999 }),
        tx({ description: "ANNUAL PLAN CO", date: d2, amountCents: 9999 }),
      ],
      [],
    );
    expect(detected[0].confidenceSignals).toContain("irregular_interval");
  });
});

// Regression: release-review finding #2. Clustering used to group purely by
// merchant name, so a merchant charging in two different currencies (a user
// who moved countries, or linked accounts in different currencies) produced
// one blended cluster: representativeAmount was a median across every
// transaction regardless of currency, while detectedToFormValues
// (review-table.tsx) separately read currency from only the earliest
// transaction — amount and currency could silently disagree.
describe("currency partitioning", () => {
  it("splits a same-merchant, mixed-currency cluster into one detection per currency", () => {
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "NETFLIX.COM", date: "2025-11-01", amountCents: 1599, currency: "usd" }),
        tx({ description: "NETFLIX.COM", date: "2025-12-01", amountCents: 1599, currency: "usd" }),
        tx({ description: "NETFLIX.COM", date: "2026-01-01", amountCents: 1799, currency: "eur" }),
        tx({ description: "NETFLIX.COM", date: "2026-02-01", amountCents: 1799, currency: "eur" }),
      ],
      [],
    );

    expect(detected).toHaveLength(2);
    const byCurrency = new Map(detected.map((d) => [d.transactions[0].currency, d]));

    const usd = byCurrency.get("usd");
    expect(usd?.amountCents).toBe(1599);
    expect(usd?.transactions.every((t) => t.currency === "usd")).toBe(true);

    const eur = byCurrency.get("eur");
    expect(eur?.amountCents).toBe(1799);
    expect(eur?.transactions.every((t) => t.currency === "eur")).toBe(true);
  });

  it("does not let a single stray-currency charge drag down the other currency's amount", () => {
    // A cross-currency median (the pre-fix behavior) would have pulled the
    // usd cluster's representativeAmount toward this one gbp outlier;
    // partitioning means it never enters the usd cluster's calculation at
    // all.
    const detected = detectRecurringSubscriptions(
      [
        tx({ description: "SPOTIFY", date: "2025-11-01", amountCents: 999, currency: "usd" }),
        tx({ description: "SPOTIFY", date: "2025-12-01", amountCents: 999, currency: "usd" }),
        tx({ description: "SPOTIFY", date: "2026-01-01", amountCents: 999, currency: "usd" }),
        tx({ description: "SPOTIFY", date: "2026-01-15", amountCents: 500, currency: "gbp" }),
      ],
      [],
    );

    const usd = detected.find((d) => d.transactions[0].currency === "usd");
    expect(usd?.amountCents).toBe(999);
  });
});
