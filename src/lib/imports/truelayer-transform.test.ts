import { describe, it, expect } from "vitest";
import { trueLayerTransactionsToRawTransactions, type TrueLayerRawTransaction } from "./truelayer-transform";
import { detectRecurringSubscriptions } from "./detection";

function trueLayerTx(overrides: Partial<TrueLayerRawTransaction>): TrueLayerRawTransaction {
  return {
    transaction_id: "txn-1",
    timestamp: "2026-01-01T00:00:00Z",
    description: "NETFLIX.COM",
    merchant_name: null,
    amount: 15.99,
    currency: "GBP",
    transaction_type: "DEBIT",
    ...overrides,
  };
}

describe("trueLayerTransactionsToRawTransactions", () => {
  it("converts a debit into a RawTransaction with correct cents and direction", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ amount: 15.99 })]);
    expect(result.transactions).toEqual([
      {
        date: "2026-01-01",
        description: "NETFLIX.COM",
        amountCents: 1599,
        direction: "debit",
        currency: "gbp",
        reference: "txn-1",
      },
    ]);
  });

  it("reads direction from transaction_type, not the amount's sign", () => {
    const result = trueLayerTransactionsToRawTransactions([
      trueLayerTx({ amount: -15.99, transaction_type: "CREDIT" }),
    ]);
    expect(result.transactions[0].direction).toBe("credit");
    expect(result.transactions[0].amountCents).toBe(1599);
  });

  it("treats an unrecognized transaction_type as a debit rather than throwing", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ transaction_type: "DIRECT_DEBIT" })]);
    expect(result.transactions[0].direction).toBe("debit");
  });

  it("prefers merchant_name over the raw description when both are present", () => {
    const result = trueLayerTransactionsToRawTransactions([
      trueLayerTx({ description: "NETFLIX.COM PAYMENT REF 123", merchant_name: "Netflix" }),
    ]);
    expect(result.transactions[0].description).toBe("Netflix");
  });

  it("falls back to description when merchant_name is null", () => {
    const result = trueLayerTransactionsToRawTransactions([
      trueLayerTx({ description: "NETFLIX.COM", merchant_name: null }),
    ]);
    expect(result.transactions[0].description).toBe("NETFLIX.COM");
  });

  it("truncates a full ISO timestamp down to its date portion", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ timestamp: "2026-03-15T14:22:31Z" })]);
    expect(result.transactions[0].date).toBe("2026-03-15");
  });

  it("skips a zero-amount transaction", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ amount: 0 })]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
  });

  it("skips a transaction with no currency and records a warning", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ currency: "" })]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("skips a transaction with no usable description and records a warning", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ description: "", merchant_name: null })]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not corrupt cents via floating-point multiplication (the 19.99*100 class of bug)", () => {
    const result = trueLayerTransactionsToRawTransactions([trueLayerTx({ amount: 19.99 })]);
    expect(result.transactions[0].amountCents).toBe(1999);
  });

  it("handles an empty transaction list", () => {
    expect(trueLayerTransactionsToRawTransactions([])).toEqual({ transactions: [], warnings: [], skippedRowCount: 0 });
  });
});

describe("TrueLayer transactions feed into the existing detection pipeline unchanged", () => {
  it("detects a recurring subscription from TrueLayer-sourced transactions with the same result shape as any other source", () => {
    const { transactions } = trueLayerTransactionsToRawTransactions([
      trueLayerTx({ transaction_id: "t1", timestamp: "2026-01-01T00:00:00Z", merchant_name: "Netflix", amount: 15.99 }),
      trueLayerTx({ transaction_id: "t2", timestamp: "2026-02-01T00:00:00Z", merchant_name: "Netflix", amount: 15.99 }),
      trueLayerTx({ transaction_id: "t3", timestamp: "2026-03-01T00:00:00Z", merchant_name: "Netflix", amount: 15.99 }),
    ]);
    const detected = detectRecurringSubscriptions(transactions, []);
    expect(detected).toHaveLength(1);
    expect(detected[0].merchant.displayName).toBe("Netflix");
    expect(detected[0].confidence).toBe("high");
  });

  it("never surfaces a single TrueLayer transaction as a recurring candidate", () => {
    const { transactions } = trueLayerTransactionsToRawTransactions([trueLayerTx({})]);
    expect(detectRecurringSubscriptions(transactions, [])).toHaveLength(0);
  });
});
