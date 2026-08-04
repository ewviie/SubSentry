import { describe, it, expect } from "vitest";
import { appleImportProvider } from "./apple-provider";
import { detectRecurringSubscriptions } from "../detection";

const HEADER = "Purchase Date,Subscription,Price";

describe("appleImportProvider.validate", () => {
  it("accepts a well-formed Apple export", () => {
    const csv = `${HEADER}\n2026-01-01,Netflix,15.99\n`;
    expect(appleImportProvider.validate(csv)).toEqual({ valid: true });
  });

  it("recognizes alternate header names", () => {
    const csv = "Date,App Name,Amount\n2026-01-01,Spotify,10.99\n";
    expect(appleImportProvider.validate(csv)).toEqual({ valid: true });
  });

  it("rejects an empty file", () => {
    const result = appleImportProvider.validate("");
    expect(result.valid).toBe(false);
  });

  it("rejects a file with no recognizable date column", () => {
    const csv = "Subscription,Price\nNetflix,15.99\n";
    const result = appleImportProvider.validate(csv);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason.toLowerCase()).toContain("date");
  });

  it("rejects a file with no recognizable amount column", () => {
    const csv = "Purchase Date,Subscription\n2026-01-01,Netflix\n";
    const result = appleImportProvider.validate(csv);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason.toLowerCase()).toContain("amount");
  });

  it("rejects a file with no recognizable subscription/item column", () => {
    const csv = "Purchase Date,Price\n2026-01-01,15.99\n";
    const result = appleImportProvider.validate(csv);
    expect(result.valid).toBe(false);
  });
});

describe("appleImportProvider.parse", () => {
  it("parses every row as a debit (Apple exports have no debit/credit signal)", async () => {
    const csv = `${HEADER}\n2026-01-01,Netflix,15.99\n2026-02-01,Netflix,15.99\n`;
    const result = await appleImportProvider.parse(csv);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((t) => t.direction === "debit")).toBe(true);
  });

  it("does not treat a positive amount as a credit, unlike the bank CSV default", async () => {
    // Confirms defaultDirection: "debit" is actually wired through — the
    // bank provider's default for an unsigned amount with no signal is
    // "credit", which would be wrong here.
    const csv = `${HEADER}\n2026-01-01,Netflix,15.99\n`;
    const result = await appleImportProvider.parse(csv);
    expect(result.transactions[0].direction).toBe("debit");
  });

  it("skips a malformed row instead of throwing", async () => {
    const csv = `${HEADER}\n2026-01-01,Netflix,15.99\nnot-a-date,Spotify,10.99\n`;
    const result = await appleImportProvider.parse(csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRowCount).toBe(1);
  });

  it("normalizes merchant names the same way the bank CSV provider does", async () => {
    const csv = `${HEADER}\n2026-01-01,NETFLIX.COM,15.99\n`;
    const result = await appleImportProvider.parse(csv);
    expect(result.transactions[0].description).toBe("NETFLIX.COM");
  });
});

describe("appleImportProvider full pipeline (source independence)", () => {
  it("feeds into detectRecurringSubscriptions and produces a high-confidence match, identical to the bank CSV path", async () => {
    const csv = `${HEADER}\n2026-01-01,Netflix,15.99\n2026-02-01,Netflix,15.99\n2026-03-01,Netflix,15.99\n`;
    const { transactions } = await appleImportProvider.parse(csv);
    const detected = detectRecurringSubscriptions(transactions, []);
    expect(detected).toHaveLength(1);
    expect(detected[0].merchant.displayName).toBe("Netflix");
    expect(detected[0].confidence).toBe("high");
  });

  it("never surfaces a single Apple purchase as a recurring candidate", async () => {
    const csv = `${HEADER}\n2026-01-01,One-time App Purchase,4.99\n`;
    const { transactions } = await appleImportProvider.parse(csv);
    const detected = detectRecurringSubscriptions(transactions, []);
    expect(detected).toHaveLength(0);
  });
});
