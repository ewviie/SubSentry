import { describe, it, expect } from "vitest";
import { subscriptionsToCsv } from "./export";
import type { Subscription } from "@/lib/db/schema";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    userId: "user-1",
    name: "Netflix",
    amountCents: 1599,
    currency: "usd",
    billingCycle: "monthly",
    category: "streaming",
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

describe("subscriptionsToCsv", () => {
  it("writes a header row followed by one row per subscription, in the same units the UI shows", () => {
    const csv = subscriptionsToCsv([makeSubscription()]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Name,Amount,Currency,Billing cycle,Category,Next renewal,Status,Notes");
    // 1599 cents -> "15.99", not raw cents — the same unit centsToAmountString
    // gives the manual-add form. Category/billing-cycle/status use their
    // display labels, not the raw enum values, so it reads like the app.
    expect(lines[1]).toBe("Netflix,15.99,USD,Monthly,Streaming,2099-01-01,Active,");
  });

  it("returns just the header for an empty list, not an error or a fabricated row", () => {
    const csv = subscriptionsToCsv([]);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("quotes and escapes a name containing a comma, a quote, or a newline", () => {
    const csv = subscriptionsToCsv([makeSubscription({ name: 'Gym, "Premium" plan' })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toContain('"Gym, ""Premium"" plan"');
  });

  it("writes an empty field, not the literal word null, for a subscription with no notes", () => {
    const csv = subscriptionsToCsv([makeSubscription({ notes: null })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1].endsWith(",")).toBe(true);
    expect(lines[1]).not.toContain("null");
  });

  it("includes real notes text verbatim when present", () => {
    const csv = subscriptionsToCsv([makeSubscription({ notes: "Shared with family" })]);
    expect(csv).toContain("Shared with family");
  });
});
