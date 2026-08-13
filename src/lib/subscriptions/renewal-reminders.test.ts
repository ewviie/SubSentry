import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  escapeHtml,
  renewalReminderSubject,
  buildSubscriptionUrl,
  isRenewalReminderJobConfigured,
  buildUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  verifyCronAuth,
} from "./renewal-reminders";

// Pure-logic coverage only — no DB, no network. See
// renewal-reminders.db.test.ts for the candidate query / claim / reclaim /
// concurrency / ownership tests, which need a real Postgres instance (same
// split queries.test.ts vs queries.concurrency.test.ts/queries.idor.test.ts
// already use).

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

describe("escapeHtml", () => {
  it("escapes every HTML-meaningful character", () => {
    expect(escapeHtml(`<script>alert("hi") & 'bye'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;) &amp; &#39;bye&#39;&lt;/script&gt;",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Netflix Premium")).toBe("Netflix Premium");
  });

  it("neutralizes an attribute-breakout attempt in a subscription name", () => {
    const malicious = `Netflix" onmouseover="alert(1)`;
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain('"');
    expect(escaped).toContain("&quot;");
  });
});

describe("renewalReminderSubject", () => {
  it("says 'today' at day 0", () => {
    expect(renewalReminderSubject("Netflix", 0)).toBe("Netflix renews today");
  });

  it("says 'tomorrow' at day 1, not 'in 1 days'", () => {
    expect(renewalReminderSubject("Netflix", 1)).toBe("Netflix renews tomorrow");
  });

  it("says 'in N days' for N >= 2", () => {
    expect(renewalReminderSubject("Netflix", 3)).toBe("Netflix renews in 3 days");
  });

  it("still reads correctly for a late catch-up run past the original day", () => {
    // A run that missed its window and only catches up after the renewal
    // date has technically passed must never claim a future-tense "renews
    // in N days" — the 'today' branch is the last honest thing it can say.
    expect(renewalReminderSubject("Netflix", -2)).toBe("Netflix renews today");
  });
});

describe("buildSubscriptionUrl", () => {
  it("deep links directly to the existing subscription detail route", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://subsentry.app";
    expect(buildSubscriptionUrl("sub-123")).toBe("https://subsentry.app/subscriptions/sub-123");
  });
});

describe("isRenewalReminderJobConfigured / verifyCronAuth", () => {
  it("is unconfigured, and every auth header is rejected, when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(isRenewalReminderJobConfigured()).toBe(false);
    expect(verifyCronAuth("Bearer anything")).toBe(false);
    expect(verifyCronAuth(null)).toBe(false);
  });

  it("accepts only the exact configured bearer token", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    expect(isRenewalReminderJobConfigured()).toBe(true);
    expect(verifyCronAuth("Bearer s3cr3t-cron-value")).toBe(true);
    expect(verifyCronAuth("Bearer wrong-value")).toBe(false);
    expect(verifyCronAuth("Bearer s3cr3t-cron-valu")).toBe(false); // truncated
    expect(verifyCronAuth("s3cr3t-cron-value")).toBe(false); // missing "Bearer " prefix
    expect(verifyCronAuth(null)).toBe(false);
  });
});

describe("unsubscribe token", () => {
  it("returns null (feature inert) when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(buildUnsubscribeToken("user-1")).toBeNull();
    expect(buildUnsubscribeUrl("user-1")).toBeNull();
  });

  it("round-trips: a token built for a user verifies for that same user", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const token = buildUnsubscribeToken("user-1");
    expect(token).not.toBeNull();
    expect(verifyUnsubscribeToken("user-1", token!)).toBe(true);
  });

  it("rejects a token built for a different user (no cross-user forgery)", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const tokenForUser1 = buildUnsubscribeToken("user-1")!;
    expect(verifyUnsubscribeToken("user-2", tokenForUser1)).toBe(false);
  });

  it("rejects a tampered token", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const token = buildUnsubscribeToken("user-1")!;
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0");
    expect(verifyUnsubscribeToken("user-1", tampered)).toBe(false);
  });

  it("rejects a malformed/short token without throwing", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    expect(() => verifyUnsubscribeToken("user-1", "not-hex!!")).not.toThrow();
    expect(verifyUnsubscribeToken("user-1", "not-hex!!")).toBe(false);
    expect(verifyUnsubscribeToken("user-1", "")).toBe(false);
  });

  it("derives a different key than the raw CRON_SECRET (key separation)", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    const unsubscribeToken = buildUnsubscribeToken("user-1")!;
    // The cron bearer token IS the raw secret; the unsubscribe token must
    // not equal it or trivially embed it — this catches a regression where
    // deriveKey's purpose-label HMAC step gets accidentally removed.
    expect(unsubscribeToken).not.toBe("s3cr3t-cron-value");
    expect(verifyCronAuth(`Bearer ${unsubscribeToken}`)).toBe(false);
  });

  it("builds a URL carrying both the user id and the token", () => {
    process.env.CRON_SECRET = "s3cr3t-cron-value";
    process.env.NEXT_PUBLIC_APP_URL = "https://subsentry.app";
    const url = new URL(buildUnsubscribeUrl("user-1")!);
    expect(url.pathname).toBe("/api/renewal-reminders/unsubscribe");
    expect(url.searchParams.get("u")).toBe("user-1");
    expect(url.searchParams.get("t")).toBe(buildUnsubscribeToken("user-1"));
  });
});
