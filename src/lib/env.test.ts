import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateEnv } from "./env";

const KEYS = [
  "DATABASE_URL",
  "TOKEN_ENCRYPTION_KEY",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "TRUELAYER_CLIENT_ID",
  "TRUELAYER_CLIENT_SECRET",
  "STRIPE_PAYMENT_LINK",
  "STRIPE_WEBHOOK_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("validateEnv", () => {
  it("flags a missing DATABASE_URL", () => {
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "DATABASE_URL")).toBe(true);
  });

  it("flags a malformed DATABASE_URL", () => {
    process.env.DATABASE_URL = "not-a-url";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "DATABASE_URL")).toBe(true);
  });

  it("accepts a well-formed DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "DATABASE_URL")).toBe(false);
  });

  it("flags a TOKEN_ENCRYPTION_KEY that isn't 32 bytes of base64", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "TOKEN_ENCRYPTION_KEY")).toBe(true);
  });

  it("accepts a valid 32-byte TOKEN_ENCRYPTION_KEY", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "TOKEN_ENCRYPTION_KEY")).toBe(false);
  });

  it("flags a half-configured Plaid pair", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.PLAID_CLIENT_ID = "client-id";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "PLAID_SECRET")).toBe(true);
  });

  it("does not flag Plaid when fully configured", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.PLAID_CLIENT_ID = "client-id";
    process.env.PLAID_SECRET = "secret";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "PLAID_SECRET" || i.variable === "PLAID_CLIENT_ID")).toBe(false);
  });

  it("does not flag Plaid when fully unconfigured", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable.startsWith("PLAID"))).toBe(false);
  });

  it("flags a Stripe payment link with no webhook secret", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "STRIPE_WEBHOOK_SECRET")).toBe(true);
  });

  it("flags a half-configured Upstash pair", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "UPSTASH_REDIS_REST_TOKEN")).toBe(true);
  });

  it("does not flag Upstash when fully configured or fully unconfigured", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    expect(validateEnv().some((i) => i.variable.startsWith("UPSTASH"))).toBe(false);

    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    expect(validateEnv().some((i) => i.variable.startsWith("UPSTASH"))).toBe(false);
  });

  it("flags a half-configured Turnstile pair", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "TURNSTILE_SECRET_KEY")).toBe(true);
  });

  it("does not flag Turnstile when fully configured or fully unconfigured", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    expect(validateEnv().some((i) => i.variable.includes("TURNSTILE"))).toBe(false);

    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    expect(validateEnv().some((i) => i.variable.includes("TURNSTILE"))).toBe(false);
  });

  it("flags RESEND_API_KEY set without RESEND_FROM_EMAIL", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.RESEND_API_KEY = "re_test_key";
    const issues = validateEnv();
    expect(issues.some((i) => i.variable === "RESEND_FROM_EMAIL")).toBe(true);
  });

  it("does not flag RESEND_FROM_EMAIL when RESEND_API_KEY is also set, or when both are unset", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    expect(validateEnv().some((i) => i.variable === "RESEND_FROM_EMAIL")).toBe(false);

    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "SubSentry <noreply@subsentry.app>";
    expect(validateEnv().some((i) => i.variable === "RESEND_FROM_EMAIL")).toBe(false);
  });
});
