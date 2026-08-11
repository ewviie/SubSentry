import { describe, it, expect } from "vitest";
import { extractTransactionsFromMessages, GMAIL_SEARCH_QUERY, MAX_MESSAGES_PER_SYNC } from "./gmail-extract";
import type { GmailMessage, GmailMessagePart } from "./gmail-client";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function makeMessage(overrides: {
  id?: string;
  internalDate?: string;
  from?: string;
  subject?: string;
  plainBody?: string;
  htmlBody?: string;
  snippet?: string;
}): GmailMessage {
  const parts = [];
  if (overrides.plainBody !== undefined) {
    parts.push({ mimeType: "text/plain", body: { data: b64(overrides.plainBody) } });
  }
  if (overrides.htmlBody !== undefined) {
    parts.push({ mimeType: "text/html", body: { data: b64(overrides.htmlBody) } });
  }
  return {
    id: overrides.id ?? "msg-1",
    internalDate: overrides.internalDate ?? "1735689600000", // 2025-01-01T00:00:00Z
    snippet: overrides.snippet ?? "",
    payload: {
      headers: [
        { name: "From", value: overrides.from ?? "Netflix <billing@netflix.com>" },
        { name: "Subject", value: overrides.subject ?? "Your receipt from Netflix" },
      ],
      mimeType: "multipart/alternative",
      parts,
    },
  };
}

describe("extractTransactionsFromMessages", () => {
  it("extracts amount, currency, merchant, and date from a plain-text receipt", () => {
    const result = extractTransactionsFromMessages([
      makeMessage({ plainBody: "Thanks for being a member. Total: $15.99. Your next billing date is Feb 1." }),
    ]);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      description: "Netflix",
      amountCents: 1599,
      currency: "usd",
      direction: "debit",
      date: "2025-01-01",
      reference: "msg-1",
    });
    expect(result.skippedRowCount).toBe(0);
  });

  it("falls back to stripping HTML when there's no text/plain part", () => {
    const result = extractTransactionsFromMessages([
      makeMessage({
        htmlBody: "<html><body><p>Your <b>Spotify</b> receipt</p><p>Amount charged: <b>$9.99</b></p></body></html>",
        from: "Spotify <no-reply@spotify.com>",
      }),
    ]);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amountCents).toBe(999);
    expect(result.transactions[0].description).toBe("Spotify");
  });

  it("recognizes € and £ symbols and maps them to the right currency code", () => {
    const eur = extractTransactionsFromMessages([makeMessage({ plainBody: "Total: €12.00" })]);
    const gbp = extractTransactionsFromMessages([makeMessage({ plainBody: "Total: £4.99" })]);

    expect(eur.transactions[0].currency).toBe("eur");
    expect(gbp.transactions[0].currency).toBe("gbp");
  });

  it("derives the merchant name from a display-name-less From address", () => {
    const result = extractTransactionsFromMessages([
      makeMessage({ from: "billing@adobe.com", plainBody: "Total: $54.99" }),
    ]);
    expect(result.transactions[0].description).toBe("Billing");
  });

  // Never guesses — a message the heuristic can't confidently read is
  // skipped with a warning, not silently assigned a wrong or zero amount
  // (see gmail-extract.ts's file header on why: a missed subscription is
  // recoverable by adding it manually, a wrong one silently corrupts real
  // financial data).
  it("skips a message with no extractable amount and reports it as a warning, not silently", () => {
    const result = extractTransactionsFromMessages([
      makeMessage({ plainBody: "Your order has shipped! Track it here." }),
    ]);

    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
    expect(result.warnings[0]).toMatch(/1 email.*couldn't be confidently read/);
  });

  it("falls back to the message snippet when neither a plain nor html body part exists", () => {
    const result = extractTransactionsFromMessages([
      makeMessage({ snippet: "Total: $6.99 charged to your card ending 4242" }),
    ]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amountCents).toBe(699);
  });

  it("processes multiple messages independently, mixing hits and skips", () => {
    const result = extractTransactionsFromMessages([
      makeMessage({ id: "a", plainBody: "Total: $9.99" }),
      makeMessage({ id: "b", plainBody: "no amount here" }),
      makeMessage({ id: "c", plainBody: "Amount charged: $54.99" }),
    ]);
    expect(result.transactions).toHaveLength(2);
    expect(result.skippedRowCount).toBe(1);
  });
});

// Builds a chain of nested multipart parts `depth` levels deep, with the
// real text/plain body only at the very bottom — mirrors the shape a
// maliciously (or just unusually) deeply-nested MIME message would have.
function makeNestedMessage(depth: number, plainBody: string): GmailMessage {
  let innermost: GmailMessagePart = { mimeType: "text/plain", body: { data: b64(plainBody) } };
  for (let i = 0; i < depth; i++) {
    innermost = { mimeType: "multipart/mixed", parts: [innermost] };
  }
  return {
    id: "nested-msg",
    internalDate: "1735689600000",
    snippet: "",
    payload: {
      headers: [
        { name: "From", value: "Netflix <billing@netflix.com>" },
        { name: "Subject", value: "Your receipt from Netflix" },
      ],
      mimeType: "multipart/mixed",
      parts: [innermost],
    },
  };
}

// Regression coverage for the MIME recursion depth cap — before this,
// extractBodyText's tree walk had no depth limit at all, so a message with
// a pathologically deep `parts` chain (crafted by whoever sent it — Gmail's
// search only filters by subject/sender, not MIME shape) risked a stack
// overflow on that one request.
describe("MIME recursion depth cap", () => {
  it("still extracts a body nested well within the depth cap", () => {
    const result = extractTransactionsFromMessages([makeNestedMessage(5, "Total: $12.00")]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amountCents).toBe(1200);
  });

  it("does not throw or hang on an extremely deep MIME tree", () => {
    expect(() => extractTransactionsFromMessages([makeNestedMessage(50_000, "Total: $12.00")])).not.toThrow();
  });

  it("skips (rather than crashes on) a body nested past the depth cap", () => {
    // Past the cap, extractBodyText finds nothing — falls back to the
    // (empty) snippet, so this becomes an unreadable-charge skip like any
    // other unparseable message, not a crash.
    const result = extractTransactionsFromMessages([makeNestedMessage(50_000, "Total: $12.00")]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skippedRowCount).toBe(1);
  });
});

describe("GMAIL_SEARCH_QUERY / MAX_MESSAGES_PER_SYNC", () => {
  it("bounds one sync's Gmail API calls to a fixed, small ceiling", () => {
    expect(MAX_MESSAGES_PER_SYNC).toBeGreaterThan(0);
    expect(MAX_MESSAGES_PER_SYNC).toBeLessThanOrEqual(100);
  });

  it("narrows to subscription-shaped mail server-side, not a full-inbox scan", () => {
    expect(GMAIL_SEARCH_QUERY).toContain("newer_than:1y");
    expect(GMAIL_SEARCH_QUERY.toLowerCase()).toContain("receipt");
  });
});
