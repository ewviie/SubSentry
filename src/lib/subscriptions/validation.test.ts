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

  const validInput = {
    name: "Netflix",
    amount: "15.99",
    billingCycle: "monthly" as const,
    nextRenewalDate: "2026-01-01",
  };

  it("rejects a name over the 120-char limit", () => {
    const result = subscriptionInputSchema.safeParse({ ...validInput, name: "a".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(subscriptionInputSchema.safeParse({ ...validInput, name: "" }).success).toBe(false);
  });

  it("rejects an amount above the Postgres integer-cents ceiling", () => {
    expect(subscriptionInputSchema.safeParse({ ...validInput, amount: "99999999.99" }).success).toBe(false);
  });

  it("rejects a malformed amount string (injection/formula attempt)", () => {
    for (const bad of ["=cmd|'/c calc'", "15.99; DROP TABLE subscriptions;", "abc", "-15.99", "15.999"]) {
      expect(subscriptionInputSchema.safeParse({ ...validInput, amount: bad }).success, bad).toBe(false);
    }
  });

  it("rejects a category outside the closed enum", () => {
    expect(subscriptionInputSchema.safeParse({ ...validInput, category: "not-a-real-category" }).success).toBe(false);
  });

  it("rejects a calendar-invalid date (e.g. Feb 31) despite matching the YYYY-MM-DD shape", () => {
    expect(subscriptionInputSchema.safeParse({ ...validInput, nextRenewalDate: "2026-02-31" }).success).toBe(false);
  });

  it("rejects notes over the 2000-char limit", () => {
    expect(subscriptionInputSchema.safeParse({ ...validInput, notes: "a".repeat(2001) }).success).toBe(false);
  });

  it("silently strips unexpected fields rather than erroring or passing them through", () => {
    const result = subscriptionInputSchema.parse({ ...validInput, isAdmin: true, userId: "attacker-controlled-id" });
    expect(result).not.toHaveProperty("isAdmin");
    expect(result).not.toHaveProperty("userId");
  });
});
