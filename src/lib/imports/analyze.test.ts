import { describe, it, expect } from "vitest";
import { analyzeParsedTransactions } from "./analyze";
import type { ImportParseResult, RawTransaction } from "./types";

function makeTransaction(i: number): RawTransaction {
  return {
    date: "2025-01-01",
    description: `Merchant ${i}`,
    amountCents: 999,
    direction: "debit",
    currency: "usd",
  };
}

function parseResultWith(count: number): ImportParseResult {
  return {
    transactions: Array.from({ length: count }, (_, i) => makeTransaction(i)),
    warnings: [],
    skippedRowCount: 0,
  };
}

// Regression coverage for the import row-count cap — before this, only file
// byte size was bounded (5-10MB), so a file of many short rows could carry
// a very large row count, each paying detection's per-row merchant-matching
// cost synchronously in the request path.
describe("analyzeParsedTransactions row-count cap", () => {
  it("processes every row when under the cap, with no truncation warning", () => {
    const result = analyzeParsedTransactions(parseResultWith(50), []);
    expect(result.warnings.some((w) => w.includes("only the first"))).toBe(false);
    expect(result.skippedRowCount).toBe(0);
  });

  it("truncates a pathologically large row count rather than processing all of it", () => {
    const result = analyzeParsedTransactions(parseResultWith(20_000), []);
    expect(result.warnings.some((w) => w.includes("only the first"))).toBe(true);
    // Every row past the cap counts as skipped — a caller-visible signal
    // that the import was partial, not a silent drop.
    expect(result.skippedRowCount).toBeGreaterThan(0);
  });

  it("does not throw or hang on an extreme row count", () => {
    expect(() => analyzeParsedTransactions(parseResultWith(100_000), [])).not.toThrow();
  });
});
