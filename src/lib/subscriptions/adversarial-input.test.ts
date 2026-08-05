import { describe, it, expect } from "vitest";
import { subscriptionInputSchema } from "./validation";

// Explicit adversarial-payload coverage for the schema every subscription
// mutation (manual create, quick-add, CSV/bank import confirm) is re-validated
// through server-side (see api/subscriptions/route.ts and
// api/imports/confirm/route.ts's own comments on why nothing from a prior
// step is ever trusted at this boundary). SQL injection isn't actually
// reachable here regardless — every DB write goes through Drizzle's
// parameterized query builder, never raw string interpolation (verified in
// DATABASE_QUERY_AUDIT.md) — so these prove the *defense in depth* layer
// (the payload never even reaches a query as anything other than an inert
// string value) rather than proving injection is possible without it.
const SQLI_PAYLOADS = [
  "'; DROP TABLE subscriptions; --",
  "' OR '1'='1",
  "1; SELECT * FROM users",
  "Robert'); DROP TABLE students;--",
];

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '"><svg onload=alert(1)>',
];

function validInput() {
  return {
    name: "Netflix",
    amount: "15.99",
    billingCycle: "monthly" as const,
    nextRenewalDate: "2026-01-01",
  };
}

describe("subscriptionInputSchema — adversarial name payloads", () => {
  it.each(SQLI_PAYLOADS)("accepts a SQL-injection-shaped name as an inert string: %s", (payload) => {
    // Zod has no reason to reject these on shape (a name field allows
    // arbitrary text) — the point is confirming they parse to a plain,
    // unmodified string that only ever reaches the DB as a bound
    // parameter, never concatenated into a query.
    const result = subscriptionInputSchema.safeParse({ ...validInput(), name: payload });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe(payload);
  });

  it.each(XSS_PAYLOADS)("accepts an XSS-shaped name as an inert string, not markup: %s", (payload) => {
    const result = subscriptionInputSchema.safeParse({ ...validInput(), name: payload });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe(payload);
  });

  it("rejects a name past the length limit regardless of payload shape", () => {
    const result = subscriptionInputSchema.safeParse({ ...validInput(), name: "<script>".repeat(20) });
    expect(result.success).toBe(false);
  });
});

describe("subscriptionInputSchema — malformed/oversized requests", () => {
  it("rejects a completely empty object", () => {
    expect(subscriptionInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects null", () => {
    expect(subscriptionInputSchema.safeParse(null).success).toBe(false);
  });

  it("rejects an array where an object is expected", () => {
    expect(subscriptionInputSchema.safeParse([validInput()]).success).toBe(false);
  });

  it("rejects a deeply oversized notes field", () => {
    const result = subscriptionInputSchema.safeParse({ ...validInput(), notes: "x".repeat(50_000) });
    expect(result.success).toBe(false);
  });

  it("rejects a wrong-typed amount (number instead of the expected string)", () => {
    const result = subscriptionInputSchema.safeParse({ ...validInput(), amount: 15.99 });
    expect(result.success).toBe(false);
  });

  it("rejects a prototype-pollution-shaped key without crashing", () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "name": "x", "amount": "9.99", "billingCycle": "monthly", "nextRenewalDate": "2026-01-01"}');
    const result = subscriptionInputSchema.safeParse(malicious);
    // Zod's object parsing only ever reads declared keys — __proto__ as an
    // own JSON key is inert here, never actually reaching Object.prototype.
    expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    if (result.success) {
      expect(result.data).not.toHaveProperty("__proto__", { polluted: true });
    }
  });
});
