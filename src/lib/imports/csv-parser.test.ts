import { describe, it, expect } from "vitest";
import { parseCsvRows, normalizeHeaders, parseCsvTransactions, type HeaderAliases } from "./csv-parser";

const ALIASES: HeaderAliases = {
  date: ["date"],
  description: ["description"],
  merchant: ["merchant"],
  amount: ["amount"],
  debit: ["debit"],
  credit: ["credit"],
  direction: ["type"],
  reference: ["reference"],
  currency: ["currency"],
};

describe("parseCsvRows", () => {
  it("splits a simple comma-separated file into rows and fields", () => {
    const rows = parseCsvRows("a,b,c\n1,2,3\n");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    const rows = parseCsvRows('Date,Description,Amount\n2026-01-01,"Coffee, Tea & Co",5.00\n');
    expect(rows[1]).toEqual(["2026-01-01", "Coffee, Tea & Co", "5.00"]);
  });

  it("handles a doubled quote as an escaped literal quote inside a quoted field", () => {
    const rows = parseCsvRows('Date,Description\n2026-01-01,"Joe""s Diner"\n');
    expect(rows[1]).toEqual(["2026-01-01", 'Joe"s Diner']);
  });

  it("handles a quoted field containing an embedded newline", () => {
    const rows = parseCsvRows('Date,Description\n2026-01-01,"Line one\nLine two"\n');
    expect(rows[1]).toEqual(["2026-01-01", "Line one\nLine two"]);
  });

  it("strips a leading BOM", () => {
    const rows = parseCsvRows("﻿Date,Amount\n2026-01-01,5.00\n");
    expect(rows[0]).toEqual(["Date", "Amount"]);
  });

  it("returns an empty array for an empty file", () => {
    expect(parseCsvRows("")).toEqual([]);
  });

  it("handles a file with no trailing newline", () => {
    const rows = parseCsvRows("a,b\n1,2");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("normalizeHeaders", () => {
  it("finds each column regardless of order", () => {
    const map = normalizeHeaders(["Amount", "Date", "Merchant"], ALIASES);
    expect(map.amount).toBe(0);
    expect(map.date).toBe(1);
    expect(map.merchant).toBe(2);
  });

  it("is case- and punctuation-insensitive", () => {
    const map = normalizeHeaders(["  DATE ", "A-M-O-U-N-T"], ALIASES);
    expect(map.date).toBe(0);
    expect(map.amount).toBe(1);
  });

  it("returns null for a column that isn't present", () => {
    const map = normalizeHeaders(["Date", "Amount"], ALIASES);
    expect(map.merchant).toBeNull();
    expect(map.currency).toBeNull();
  });
});

describe("parseCsvTransactions", () => {
  it("parses column-order-independently: shuffled headers produce the same result", () => {
    const a = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,Netflix,15.99\n", { aliases: ALIASES });
    const b = parseCsvTransactions("Amount,Date,Merchant\n15.99,2026-01-01,Netflix\n", { aliases: ALIASES });
    expect(a.transactions).toEqual(b.transactions);
  });

  it("detects currency from an explicit currency column", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount,Currency\n2026-01-01,Netflix,15.99,gbp\n", {
      aliases: ALIASES,
    });
    expect(result.transactions[0].currency).toBe("gbp");
  });

  it("detects currency from a symbol prefix when no currency column exists", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,Netflix,£15.99\n", { aliases: ALIASES });
    expect(result.transactions[0].currency).toBe("gbp");
  });

  it("defaults to USD with a warning when no currency signal exists at all", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,Netflix,15.99\n", { aliases: ALIASES });
    expect(result.transactions[0].currency).toBe("usd");
    expect(result.warnings.some((w) => w.includes("USD"))).toBe(true);
  });

  it("reads direction from a single signed amount column", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,Netflix,-15.99\n2026-01-02,Refund,20.00\n", {
      aliases: ALIASES,
    });
    expect(result.transactions[0]).toMatchObject({ direction: "debit", amountCents: 1599 });
    expect(result.transactions[1]).toMatchObject({ direction: "credit", amountCents: 2000 });
  });

  it("reads direction from separate debit/credit columns", () => {
    const result = parseCsvTransactions("Date,Merchant,Debit,Credit\n2026-01-01,Netflix,15.99,\n2026-01-02,Refund,,20.00\n", {
      aliases: ALIASES,
    });
    expect(result.transactions[0]).toMatchObject({ direction: "debit", amountCents: 1599 });
    expect(result.transactions[1]).toMatchObject({ direction: "credit", amountCents: 2000 });
  });

  it("skips a row with an unparseable date instead of throwing, and records a warning", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\nnot-a-date,Netflix,15.99\n", { aliases: ALIASES });
    expect(result.transactions).toEqual([]);
    expect(result.skippedRowCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("skips a row with a missing amount instead of throwing", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,Netflix,\n", { aliases: ALIASES });
    expect(result.transactions).toEqual([]);
    expect(result.skippedRowCount).toBe(1);
  });

  it("skips a row with a missing merchant/description instead of throwing", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,,15.99\n", { aliases: ALIASES });
    expect(result.transactions).toEqual([]);
    expect(result.skippedRowCount).toBe(1);
  });

  it("skips blank rows without counting them as malformed", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n2026-01-01,Netflix,15.99\n\n", { aliases: ALIASES });
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRowCount).toBe(0);
  });

  it("returns a clear warning for a header-only file with no data rows", () => {
    const result = parseCsvTransactions("Date,Merchant,Amount\n", { aliases: ALIASES });
    expect(result.transactions).toEqual([]);
    expect(result.skippedRowCount).toBe(0);
  });

  it("returns a clear warning for a completely empty file", () => {
    const result = parseCsvTransactions("", { aliases: ALIASES });
    expect(result.transactions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns a clear warning when no recognizable date column exists", () => {
    const result = parseCsvTransactions("Merchant,Amount\nNetflix,15.99\n", { aliases: ALIASES });
    expect(result.warnings.some((w) => w.toLowerCase().includes("date"))).toBe(true);
  });
});
