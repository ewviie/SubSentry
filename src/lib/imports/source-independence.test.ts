import { describe, it, expect } from "vitest";
import { csvBankImportProvider } from "./providers/csv-bank-provider";
import { appleImportProvider } from "./providers/apple-provider";
import { googlePlayImportProvider } from "./providers/google-play-provider";
import { detectRecurringSubscriptions } from "./detection";
import type { ImportProvider } from "./provider";

// Three logically-identical monthly Netflix charges, expressed in each
// provider's own native export shape. If the pipeline is genuinely
// source-agnostic, detectRecurringSubscriptions() must produce the same
// confidence/cycle/amount result regardless of which provider parsed the
// input — proving detection, merchant normalization, and confidence
// scoring never branch on source.
const FIXTURES: { provider: ImportProvider; csv: string }[] = [
  {
    provider: csvBankImportProvider,
    csv: "Date,Merchant,Amount\n2026-01-01,NETFLIX.COM,-15.99\n2026-02-01,NETFLIX.COM,-15.99\n2026-03-01,NETFLIX.COM,-15.99\n",
  },
  {
    provider: appleImportProvider,
    csv: "Purchase Date,Subscription,Price\n2026-01-01,NETFLIX.COM,15.99\n2026-02-01,NETFLIX.COM,15.99\n2026-03-01,NETFLIX.COM,15.99\n",
  },
  {
    provider: googlePlayImportProvider,
    csv: "Order Date,Product,Amount\n2026-01-01,NETFLIX.COM,15.99\n2026-02-01,NETFLIX.COM,15.99\n2026-03-01,NETFLIX.COM,15.99\n",
  },
];

describe("source independence", () => {
  it.each(FIXTURES)("$provider.id produces an identical detection result for equivalent data", async ({ provider, csv }) => {
    const { transactions } = await provider.parse(csv);
    const detected = detectRecurringSubscriptions(transactions, []);

    expect(detected).toHaveLength(1);
    expect(detected[0].merchant.displayName).toBe("Netflix");
    expect(detected[0].merchant.category).toBe("streaming");
    expect(detected[0].merchant.isKnownSubscriptionMerchant).toBe(true);
    expect(detected[0].confidence).toBe("high");
    expect(detected[0].amountCents).toBe(1599);
    expect(detected[0].estimatedBillingCycle.cycle).toBe("monthly");
    expect(detected[0].monthsSeen).toBe(3);
  });

  it("all three providers report the same detected subscription across the whole fixture set, not just per-fixture", async () => {
    const results = await Promise.all(
      FIXTURES.map(async ({ provider, csv }) => {
        const { transactions } = await provider.parse(csv);
        return detectRecurringSubscriptions(transactions, [])[0];
      }),
    );
    const [csvResult, appleResult, googlePlayResult] = results;
    expect(appleResult.confidence).toBe(csvResult.confidence);
    expect(googlePlayResult.confidence).toBe(csvResult.confidence);
    expect(appleResult.estimatedBillingCycle.cycle).toBe(csvResult.estimatedBillingCycle.cycle);
    expect(googlePlayResult.estimatedBillingCycle.cycle).toBe(csvResult.estimatedBillingCycle.cycle);
  });
});
