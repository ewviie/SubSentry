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
