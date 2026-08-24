import { describe, it, expect } from "vitest";
import {
  computeSpendBySource,
  computeSpendByBillingCycle,
  computeGrowthOverTime,
  computeRenewalsTimeline,
  computeTopMerchantsBySpend,
} from "./analytics";
import type { Subscription } from "@/lib/db/schema";

let nextId = 1;
function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: `sub-${nextId++}`,
    userId: "user-1",
    name: "Test Sub",
    amountCents: 1000,
    currency: "usd",
    billingCycle: "monthly",
    category: "other",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("computeSpendBySource", () => {
  it("ignores canceled/paused subscriptions", () => {
    expect(computeSpendBySource([sub({ status: "canceled" })])).toEqual([]);
  });

  it("groups by source and sums monthly-equivalent cents", () => {
    const result = computeSpendBySource([
      sub({ source: "manual", amountCents: 1000 }),
      sub({ source: "manual", amountCents: 500 }),
      sub({ source: "plaid_import", amountCents: 2000 }),
    ]);
    const manual = result.find((r) => r.source === "manual")!;
    const plaid = result.find((r) => r.source === "plaid_import")!;
    expect(manual.monthlyCents).toBe(1500);
    expect(manual.count).toBe(2);
    expect(plaid.monthlyCents).toBe(2000);
    expect(plaid.label).toBe("Bank (Plaid)");
  });

  it("sorts descending by monthly spend", () => {
    const result = computeSpendBySource([
      sub({ source: "manual", amountCents: 500 }),
      sub({ source: "csv_import", amountCents: 5000 }),
    ]);
    expect(result[0].source).toBe("csv_import");
  });

  // Regression, reproducing an exact real-account bug: 2 USD + 1 GBP
  // subscription, all "manual" source, used to sum to 1549+800+2500=4849
  // ("$48.49") — the GBP subscription's cents silently combined into a
  // dollar figure. The correct total excludes it.
  it("excludes a non-primary-currency subscription from the sum", () => {
    const result = computeSpendBySource([
      sub({ source: "manual", amountCents: 1549, currency: "usd" }),
      sub({ source: "manual", amountCents: 800, currency: "usd" }),
      sub({ source: "manual", amountCents: 2500, currency: "gbp" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].monthlyCents).toBe(2349); // 1549 + 800, not 4849
    expect(result[0].count).toBe(2); // the GBP subscription doesn't even count here
  });
});

describe("computeSpendByBillingCycle", () => {
  it("returns cycles in a fixed order, omitting cycles with no subscriptions", () => {
    const result = computeSpendByBillingCycle([sub({ billingCycle: "yearly", amountCents: 12000 })]);
    expect(result).toEqual([{ cycle: "yearly", monthlyCents: 1000, count: 1 }]);
  });

  it("converts every cycle to its monthly-equivalent cents", () => {
    const result = computeSpendByBillingCycle([
      sub({ billingCycle: "monthly", amountCents: 1000 }),
      sub({ billingCycle: "quarterly", amountCents: 3000 }),
      sub({ billingCycle: "weekly", amountCents: 100 }),
    ]);
    expect(result.find((r) => r.cycle === "monthly")!.monthlyCents).toBe(1000);
    expect(result.find((r) => r.cycle === "quarterly")!.monthlyCents).toBe(1000);
    expect(result.find((r) => r.cycle === "weekly")!.monthlyCents).toBe(Math.round((100 * 52) / 12));
  });

  // Regression, reproducing an exact real-account bug: the "Monthly" bucket
  // used to sum 1549 (Netflix, USD) + 800 (Notion, USD) + 2500 (UK Gym,
  // GBP) = 4849 ("$48.49"). The correct total excludes the GBP subscription.
  it("excludes a non-primary-currency subscription from its cycle's sum", () => {
    const result = computeSpendByBillingCycle([
      sub({ billingCycle: "monthly", amountCents: 1549, currency: "usd" }),
      sub({ billingCycle: "monthly", amountCents: 800, currency: "usd" }),
      sub({ billingCycle: "monthly", amountCents: 2500, currency: "gbp" }),
    ]);
    const monthly = result.find((r) => r.cycle === "monthly")!;
    expect(monthly.monthlyCents).toBe(2349); // not 4849
    expect(monthly.count).toBe(2);
  });
});

describe("computeGrowthOverTime", () => {
  it("returns an empty array for no subscriptions", () => {
    expect(computeGrowthOverTime([])).toEqual([]);
  });

  it("buckets by creation month and accumulates a running total", () => {
    const points = computeGrowthOverTime([
      sub({ createdAt: new Date("2026-01-15T00:00:00Z"), amountCents: 1000 }),
      sub({ createdAt: new Date("2026-01-20T00:00:00Z"), amountCents: 500 }),
      sub({ createdAt: new Date("2026-03-01T00:00:00Z"), amountCents: 2000 }),
    ]);
    expect(points.map((p) => p.monthIso)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(points[0].addedMonthlyCents).toBe(1500);
    expect(points[0].cumulativeMonthlyCents).toBe(1500);
    expect(points[1].addedMonthlyCents).toBe(0);
    expect(points[1].cumulativeMonthlyCents).toBe(1500);
    expect(points[2].addedMonthlyCents).toBe(2000);
    expect(points[2].cumulativeMonthlyCents).toBe(3500);
  });

  it("includes canceled subscriptions — they really were added and did cost money", () => {
    const points = computeGrowthOverTime([sub({ status: "canceled", amountCents: 1000 })]);
    expect(points[0].cumulativeMonthlyCents).toBe(1000);
  });

  // Regression: this used to sum monthlyCents across ALL subscriptions
  // regardless of currency. A non-primary-currency subscription must be
  // excluded from the running total, while the canceled-subscription
  // inclusion above (a currency-unrelated, intentional design choice)
  // still holds.
  it("excludes a non-primary-currency subscription from the running total", () => {
    const points = computeGrowthOverTime([
      sub({ createdAt: new Date("2026-01-15T00:00:00Z"), amountCents: 1000, currency: "usd" }),
      sub({ createdAt: new Date("2026-01-20T00:00:00Z"), amountCents: 999999, currency: "gbp" }),
    ]);
    expect(points[0].addedMonthlyCents).toBe(1000);
    expect(points[0].cumulativeMonthlyCents).toBe(1000);
  });
});

describe("computeRenewalsTimeline", () => {
  const today = new Date("2026-01-15T00:00:00Z");

  it("returns exactly 12 months starting from the current month", () => {
    const result = computeRenewalsTimeline([], today);
    expect(result).toHaveLength(12);
    expect(result[0].monthIso).toBe("2026-01");
    expect(result[11].monthIso).toBe("2026-12");
  });

  it("counts a monthly subscription in every one of the 12 months", () => {
    const result = computeRenewalsTimeline(
      [sub({ billingCycle: "monthly", amountCents: 1000, nextRenewalDate: "2026-01-20" })],
      today,
    );
    expect(result.every((m) => m.count === 1 && m.totalCents === 1000)).toBe(true);
  });

  // Regression, reproducing an exact real-account bug seen on the Analytics
  // page: every month's totalCents used to sum 1549 (Netflix, USD) + 800
  // (Notion, USD) + 2500 (UK Gym, GBP) = 4849 ("$48.49"). The correct total
  // excludes the GBP subscription's cents, though it still counts toward
  // the month's renewal count in principle (timing is currency-agnostic —
  // here it simply isn't in the included set at all, same as the other
  // sum-restricted analytics functions above).
  it("excludes a non-primary-currency subscription from each month's total", () => {
    const result = computeRenewalsTimeline(
      [
        sub({ billingCycle: "monthly", amountCents: 1549, nextRenewalDate: "2026-01-20", currency: "usd" }),
        sub({ billingCycle: "monthly", amountCents: 800, nextRenewalDate: "2026-01-20", currency: "usd" }),
        sub({ billingCycle: "monthly", amountCents: 2500, nextRenewalDate: "2026-01-20", currency: "gbp" }),
      ],
      today,
    );
    expect(result.every((m) => m.totalCents === 2349 && m.count === 2)).toBe(true); // not 4849 / 3
  });

  it("counts a yearly subscription only in its renewal month", () => {
    const result = computeRenewalsTimeline(
      [sub({ billingCycle: "yearly", amountCents: 12000, nextRenewalDate: "2026-06-10" })],
      today,
    );
    const june = result.find((m) => m.monthIso === "2026-06")!;
    const may = result.find((m) => m.monthIso === "2026-05")!;
    expect(june.count).toBe(1);
    expect(june.totalCents).toBe(12000);
    expect(may.count).toBe(0);
  });

  it("ignores canceled subscriptions", () => {
    const result = computeRenewalsTimeline(
      [sub({ status: "canceled", billingCycle: "monthly", nextRenewalDate: "2026-01-20" })],
      today,
    );
    expect(result.every((m) => m.count === 0)).toBe(true);
  });

  it("counts a weekly subscription in every month it actually recurs in, not just its literal next renewal month", () => {
    const result = computeRenewalsTimeline(
      [sub({ billingCycle: "weekly", amountCents: 500, nextRenewalDate: "2026-01-05" })],
      today,
    );
    // A weekly charge recurs roughly every 7 days, so across 12 months it
    // should show up in every month, not only January (the literal
    // nextRenewalDate's month) the way a naive "does the renewal date fall
    // in this month" check would produce.
    expect(result.every((m) => m.count === 1)).toBe(true);
    const june = result.find((m) => m.monthIso === "2026-06")!;
    expect(june.totalCents).toBe(500);
  });

  it("does not count a weekly subscription before its first renewal occurrence", () => {
    const result = computeRenewalsTimeline(
      [sub({ billingCycle: "weekly", amountCents: 500, nextRenewalDate: "2026-03-03" })],
      today,
    );
    const january = result.find((m) => m.monthIso === "2026-01")!;
    const march = result.find((m) => m.monthIso === "2026-03")!;
    expect(january.count).toBe(0);
    expect(march.count).toBe(1);
  });
});

describe("computeTopMerchantsBySpend", () => {
  it("ranks active subscriptions by annualized spend, descending", () => {
    const cheap = sub({ name: "Cheap", billingCycle: "monthly", amountCents: 500 });
    const expensive = sub({ name: "Expensive", billingCycle: "yearly", amountCents: 24000 });
    const result = computeTopMerchantsBySpend([cheap, expensive]);
    expect(result[0].name).toBe("Expensive");
    expect(result[0].annualCents).toBe(24000);
    expect(result[1].annualCents).toBe(6000);
  });

  it("respects the limit parameter", () => {
    const subs = Array.from({ length: 10 }, (_, i) => sub({ amountCents: 1000 + i }));
    expect(computeTopMerchantsBySpend(subs, 3)).toHaveLength(3);
  });

  it("excludes canceled subscriptions", () => {
    expect(computeTopMerchantsBySpend([sub({ status: "canceled" })])).toEqual([]);
  });

  // Regression: this list used to render every row's cents via
  // formatCents(merchant.annualCents) with no currency, defaulting to USD
  // regardless of the subscription's own currency. Each row must carry its
  // real currency (this is a per-row list, not a sum, so a non-primary-
  // currency merchant still belongs in it — just labeled correctly).
  it("carries each merchant's own currency", () => {
    const gbpSub = sub({ name: "UK Gym", currency: "gbp", amountCents: 2500 });
    const usdSub = sub({ name: "Netflix", currency: "usd", amountCents: 1549 });
    const result = computeTopMerchantsBySpend([gbpSub, usdSub]);
    expect(result.find((m) => m.name === "UK Gym")?.currency).toBe("gbp");
    expect(result.find((m) => m.name === "Netflix")?.currency).toBe("usd");
  });
});
