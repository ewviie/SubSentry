import { describe, it, expect } from "vitest";
import { plaidTransactionsToRawTransactions, type PlaidRawTransaction } from "./plaid-transform";
import { detectRecurringSubscriptions } from "./detection";

function plaidTx(overrides: Partial<PlaidRawTransaction>): PlaidRawTransaction {
  return {
    transaction_id: "txn-1",
    date: "2026-01-01",
    name: "NETFLIX.COM",
    merchant_name: null,
    amount: 15.99,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    pending: false,
    ...overrides,
  };
}

describe("plaidTransactionsToRawTransactions", () => {
  it("converts a settled debit into a RawTransaction with correct cents and direction", () => {
    const result = plaidTransactionsToRawTransactions([plaidTx({ amount: 15.99 })]);
    expect(result.transactions).toEqual([
      {
        date: "2026-01-01",
        description: "NETFLIX.COM",
        amountCents: 1599,
        direction: "debit",
        currency: "usd",
        reference: "txn-1",
      },
    ]);
  });

  it("converts a negative Plaid amount to a credit (Plaid's sign convention is inverted from a typical bank CSV)", () => {
    const result = plaidTransactionsToRawTransactions([plaidTx({ amount: -20 })]);
    expect(result.transactions[0].direction).toBe("credit");
    expect(result.transactions[0].amountCents).toBe(2000);
  });

  it("prefers merchant_name over the legacy name field when both are present", () => {
    const result = plaidTransactionsToRawTransactions([
      plaidTx({ name: "NETFLIX.COM PAYMENT REF 123", merchant_name: "Netflix" }),
    ]);
    expect(result.transactions[0].description).toBe("Netflix");
  });

  it("falls back to the legacy name field when merchant_name is null", () => {
    const result = plaidTransactionsToRawTransactions([plaidTx({ name: "NETFLIX.COM", merchant_name: null })]);
    expect(result.transactions[0].description).toBe("NETFLIX.COM");
  });

  it("skips a pending transaction instead of treating it as settled", () => {
    const result = plaidTransactionsToRawTransactions([plaidTx({ pending: true })]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
  });

  it("skips a zero-amount transaction", () => {
    const result = plaidTransactionsToRawTransactions([plaidTx({ amount: 0 })]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
  });

  it("skips a transaction with no currency code at all and records a warning", () => {
    const result = plaidTransactionsToRawTransactions([
      plaidTx({ iso_currency_code: null, unofficial_currency_code: null }),
    ]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("falls back to unofficial_currency_code when iso_currency_code is null", () => {
    const result = plaidTransactionsToRawTransactions([
      plaidTx({ iso_currency_code: null, unofficial_currency_code: "BTC" }),
    ]);
    expect(result.transactions[0].currency).toBe("btc");
  });

  it("does not corrupt cents via floating-point multiplication (the 19.99*100 class of bug)", () => {
    const result = plaidTransactionsToRawTransactions([plaidTx({ amount: 19.99 })]);
    expect(result.transactions[0].amountCents).toBe(1999);
  });

  it("handles an empty transaction list", () => {
    expect(plaidTransactionsToRawTransactions([])).toEqual({ transactions: [], warnings: [], skippedRowCount: 0 });
  });
});

describe("plaid transactions feed into the existing detection pipeline unchanged", () => {
  it("detects a recurring subscription from Plaid-sourced transactions with the same result shape as any other source", () => {
    const { transactions } = plaidTransactionsToRawTransactions([
      plaidTx({ transaction_id: "t1", date: "2026-01-01", merchant_name: "Netflix", amount: 15.99 }),
      plaidTx({ transaction_id: "t2", date: "2026-02-01", merchant_name: "Netflix", amount: 15.99 }),
      plaidTx({ transaction_id: "t3", date: "2026-03-01", merchant_name: "Netflix", amount: 15.99 }),
    ]);
    const detected = detectRecurringSubscriptions(transactions, []);
    expect(detected).toHaveLength(1);
    expect(detected[0].merchant.displayName).toBe("Netflix");
    expect(detected[0].confidence).toBe("high");
  });

  it("never surfaces a single Plaid transaction as a recurring candidate", () => {
    const { transactions } = plaidTransactionsToRawTransactions([plaidTx({})]);
    expect(detectRecurringSubscriptions(transactions, [])).toHaveLength(0);
  });
});
