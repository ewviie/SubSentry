import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDigestUnsubscribeToken, verifyDigestUnsubscribeToken, buildDigestUnsubscribeUrl } from "./weekly-digest-job";

// Pure-logic coverage for the digest unsubscribe token, mirroring
// renewal-reminders.test.ts's own token tests — same shape, same reasoning.
// See weekly-digest-job.db.test.ts for candidate selection / send / spend-
// delta tests, which need a real Postgres instance.

const ENV_KEYS = ["CRON_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("buildDigestUnsubscribeToken / verifyDigestUnsubscribeToken", () => {
  it("returns null (feature inert) when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(buildDigestUnsubscribeToken("user-1")).toBeNull();
  });

  it("round-trips: a token built for a user verifies for that same user", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const token = buildDigestUnsubscribeToken("user-1");
    expect(token).not.toBeNull();
    expect(verifyDigestUnsubscribeToken("user-1", token!)).toBe(true);
  });

  it("rejects a token built for a different user", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const tokenForUser1 = buildDigestUnsubscribeToken("user-1")!;
    expect(verifyDigestUnsubscribeToken("user-2", tokenForUser1)).toBe(false);
  });

  it("rejects a tampered token", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const token = buildDigestUnsubscribeToken("user-1")!;
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0");
    expect(verifyDigestUnsubscribeToken("user-1", tampered)).toBe(false);
  });

  it("never throws on a malformed/non-hex token", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    expect(() => verifyDigestUnsubscribeToken("user-1", "not-hex!!")).not.toThrow();
    expect(verifyDigestUnsubscribeToken("user-1", "not-hex!!")).toBe(false);
    expect(verifyDigestUnsubscribeToken("user-1", "")).toBe(false);
  });

  it("derives a different key than the raw CRON_SECRET and than renewal-reminders' own unsubscribe token (key separation)", async () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const { buildUnsubscribeToken } = await import("./renewal-reminders");
    const digestToken = buildDigestUnsubscribeToken("user-1")!;
    const renewalToken = buildUnsubscribeToken("user-1")!;
    expect(digestToken).not.toBe(process.env.CRON_SECRET);
    // Same purpose input (userId), different purpose label — must not collide.
    expect(digestToken).not.toBe(renewalToken);
  });
});

describe("buildDigestUnsubscribeUrl", () => {
  it("returns null when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(buildDigestUnsubscribeUrl("user-1")).toBeNull();
  });

  it("builds a URL pointing at the digest unsubscribe route with matching user/token params", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    process.env.NEXT_PUBLIC_APP_URL = "https://subsentry.app";
    const url = new URL(buildDigestUnsubscribeUrl("user-1")!);
    expect(url.pathname).toBe("/api/notifications/digest/unsubscribe");
    expect(url.searchParams.get("u")).toBe("user-1");
    expect(url.searchParams.get("t")).toBe(buildDigestUnsubscribeToken("user-1"));
  });
});
