import { describe, it, expect } from "vitest";
import { subscriptionInputSchema, subscriptionUpdateSchema } from "./validation";

describe("subscriptionUpdateSchema", () => {
  // Regression test: Zod's .default() fires whenever a key is undefined,
  // including on an optional field produced by .partial() — so a naive
  // `subscriptionInputSchema.partial()` would silently re-fill omitted
  // fields with their create-time default. A bulk status-only update would
  // have quietly reset every selected subscription's category to "other"
  // and currency to "usd".
  it("only includes fields actually present in a partial update", () => {
    const result = subscriptionUpdateSchema.parse({ status: "paused" });
    expect(result).toEqual({ status: "paused" });
    expect(result.category).toBeUndefined();
    expect(result.currency).toBeUndefined();
  });

  it("leaves category and currency untouched on a name-only update", () => {
    const result = subscriptionUpdateSchema.parse({ name: "Renamed" });
    expect(result).toEqual({ name: "Renamed" });
  });

  it("still accepts a full update with every field", () => {
    const result = subscriptionUpdateSchema.parse({
      name: "Netflix",
      amount: "15.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2026-01-01",
      status: "active",
    });
    expect(result.category).toBe("streaming");
  });
});

describe("subscriptionInputSchema", () => {
  it("still applies create-time defaults when fields are omitted", () => {
    const result = subscriptionInputSchema.parse({
      name: "New Sub",
      amount: "9.99",
      billingCycle: "monthly",
      nextRenewalDate: "2026-01-01",
    });
    expect(result.currency).toBe("usd");
    expect(result.category).toBe("other");
    expect(result.status).toBe("active");
  });
});
