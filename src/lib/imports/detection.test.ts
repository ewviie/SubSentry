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
