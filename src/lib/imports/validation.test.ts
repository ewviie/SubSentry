import { describe, it, expect } from "vitest";
import { rawTransactionSchema, importConfirmSchema } from "./validation";

const validTransaction = {
  date: "2026-01-01",
  description: "Netflix",
  amountCents: 1599,
  direction: "debit" as const,
  currency: "usd",
};

describe("rawTransactionSchema", () => {
  it("accepts a well-formed transaction", () => {
    expect(rawTransactionSchema.safeParse(validTransaction).success).toBe(true);
  });

  it("accepts a transaction with an optional reference", () => {
    const result = rawTransactionSchema.safeParse({ ...validTransaction, reference: "TXN123" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid date shape", () => {
    expect(rawTransactionSchema.safeParse({ ...validTransaction, date: "01/01/2026" }).success).toBe(false);
  });

  it("rejects a non-positive amount", () => {
    expect(rawTransactionSchema.safeParse({ ...validTransaction, amountCents: 0 }).success).toBe(false);
    expect(rawTransactionSchema.safeParse({ ...validTransaction, amountCents: -100 }).success).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    expect(rawTransactionSchema.safeParse({ ...validTransaction, amountCents: 15.99 }).success).toBe(false);
  });

  it("rejects an invalid direction", () => {
    expect(rawTransactionSchema.safeParse({ ...validTransaction, direction: "sideways" }).success).toBe(false);
  });

  it("rejects an invalid currency code", () => {
    expect(rawTransactionSchema.safeParse({ ...validTransaction, currency: "US" }).success).toBe(false);
    expect(rawTransactionSchema.safeParse({ ...validTransaction, currency: "usdd" }).success).toBe(false);
  });

  it("rejects an empty description", () => {
    expect(rawTransactionSchema.safeParse({ ...validTransaction, description: "" }).success).toBe(false);
  });
});

const validRow = {
  name: "Netflix",
  amount: "15.99",
  currency: "usd",
  billingCycle: "monthly" as const,
  category: "streaming" as const,
  nextRenewalDate: "2026-02-01",
  status: "active" as const,
};

describe("importConfirmSchema", () => {
  it("accepts a well-formed confirm request", () => {
    const result = importConfirmSchema.safeParse({ source: "csv_import", rows: [validRow] });
    expect(result.success).toBe(true);
  });

  it("defaults ignoredCount to 0 when omitted", () => {
    const result = importConfirmSchema.parse({ source: "csv_import", rows: [validRow] });
    expect(result.ignoredCount).toBe(0);
  });

  it("restricts source to only the three import values", () => {
    expect(importConfirmSchema.safeParse({ source: "manual", rows: [validRow] }).success).toBe(false);
    expect(importConfirmSchema.safeParse({ source: "ai_parsed", rows: [validRow] }).success).toBe(false);
    expect(importConfirmSchema.safeParse({ source: "apple_import", rows: [validRow] }).success).toBe(true);
    expect(importConfirmSchema.safeParse({ source: "google_play_import", rows: [validRow] }).success).toBe(true);
  });

  it("requires at least one row", () => {
    expect(importConfirmSchema.safeParse({ source: "csv_import", rows: [] }).success).toBe(false);
  });

  it("re-validates every row through the same rules as the manual/quick-add create schema", () => {
    const invalidRow = { ...validRow, amount: "not-a-number" };
    expect(importConfirmSchema.safeParse({ source: "csv_import", rows: [invalidRow] }).success).toBe(false);
  });

  it("applies subscriptionInputSchema's own defaults to each row", () => {
    const { currency, status, category, ...minimalRow } = validRow;
    const result = importConfirmSchema.parse({ source: "csv_import", rows: [minimalRow] });
    expect(result.rows[0].currency).toBe("usd");
    expect(result.rows[0].status).toBe("active");
    expect(result.rows[0].category).toBe("other");
  });
});
