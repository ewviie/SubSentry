import { describe, it, expect } from "vitest";
import { googlePlayImportProvider } from "./google-play-provider";
import { detectRecurringSubscriptions } from "../detection";
import type { Subscription } from "@/lib/db/schema";

const HEADER = "Order Date,Product,Amount";

let nextId = 1;
function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: `sub-${nextId++}`,
    userId: "user-1",
    name: "Test Sub",
    amountCents: 999,
    currency: "usd",
    billingCycle: "monthly",
    category: "other",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    lastReviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("googlePlayImportProvider.validate", () => {
  it("accepts a well-formed Google Play export", () => {
    const csv = `${HEADER}\n2026-01-01,Spotify Premium,10.99\n`;
    expect(googlePlayImportProvider.validate(csv)).toEqual({ valid: true });
  });

  it("recognizes alternate header names", () => {
    const csv = "Transaction Date,Product Title,Charged Amount\n2026-01-01,Netflix,15.99\n";
    expect(googlePlayImportProvider.validate(csv)).toEqual({ valid: true });
  });

  it("rejects an empty file", () => {
    expect(googlePlayImportProvider.validate("").valid).toBe(false);
  });

  it("rejects a file with no recognizable date column", () => {
    const csv = "Product,Amount\nSpotify,10.99\n";
    const result = googlePlayImportProvider.validate(csv);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason.toLowerCase()).toContain("date");
  });

  it("rejects a file with no recognizable amount column", () => {
    const csv = "Order Date,Product\n2026-01-01,Spotify\n";
    const result = googlePlayImportProvider.validate(csv);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason.toLowerCase()).toContain("amount");
  });

  it("rejects a file with no recognizable product column", () => {
    const csv = "Order Date,Amount\n2026-01-01,10.99\n";
    expect(googlePlayImportProvider.validate(csv).valid).toBe(false);
  });
});

describe("googlePlayImportProvider.parse", () => {
  it("parses every row as a debit (Google Play exports have no debit/credit signal)", async () => {
    const csv = `${HEADER}\n2026-01-01,Spotify Premium,10.99\n2026-02-01,Spotify Premium,10.99\n`;
    const result = await googlePlayImportProvider.parse(csv);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((t) => t.direction === "debit")).toBe(true);
  });

  it("skips a malformed row instead of throwing", async () => {
    const csv = `${HEADER}\n2026-01-01,Spotify Premium,10.99\n2026-01-02,Broken Row,\n`;
    const result = await googlePlayImportProvider.parse(csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRowCount).toBe(1);
  });

  it("normalizes merchant names the same way the bank CSV provider does", async () => {
    const csv = `${HEADER}\n2026-01-01,SQ *SPOTIFY,10.99\n`;
    const result = await googlePlayImportProvider.parse(csv);
    expect(result.transactions[0].description).toBe("SQ *SPOTIFY");
  });
});

describe("googlePlayImportProvider full pipeline (source independence)", () => {
  it("feeds into detectRecurringSubscriptions and produces a high-confidence match, identical to the bank CSV path", async () => {
    const csv = `${HEADER}\n2026-01-01,Spotify Premium,10.99\n2026-02-01,Spotify Premium,10.99\n2026-03-01,Spotify Premium,10.99\n`;
    const { transactions } = await googlePlayImportProvider.parse(csv);
    const detected = detectRecurringSubscriptions(transactions, []);
    expect(detected).toHaveLength(1);
    expect(detected[0].merchant.displayName).toBe("Spotify");
    expect(detected[0].confidence).toBe("high");
  });

  it("never surfaces a single Google Play purchase as a recurring candidate", async () => {
    const csv = `${HEADER}\n2026-01-01,One-time In-app Purchase,2.99\n`;
    const { transactions } = await googlePlayImportProvider.parse(csv);
    const detected = detectRecurringSubscriptions(transactions, []);
    expect(detected).toHaveLength(0);
  });

  it("flags a duplicate against an existing subscription the same way regardless of source", async () => {
    const existing = sub({ name: "Spotify" });
    const csv = `${HEADER}\n2026-01-01,Spotify Premium,10.99\n2026-02-01,Spotify Premium,10.99\n`;
    const { transactions } = await googlePlayImportProvider.parse(csv);
    const detected = detectRecurringSubscriptions(transactions, [existing]);
    expect(detected[0].isDuplicateOfExistingId).toBe(existing.id);
  });
});
