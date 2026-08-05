import { describe, it, expect } from "vitest";
import { checkVerifyEmailRateLimit, checkResendVerificationRateLimit } from "./rate-limit";

// The generic limiter mechanics (window reset, per-key isolation) are
// already covered by src/lib/rate-limit.test.ts, and the Redis-vs-fallback
// branching by src/lib/rate-limit-distributed.test.ts — these just confirm
// the two verification-flow limiters are actually wired to real, finite
// limits rather than e.g. accidentally sharing state or never firing. Async
// because these are now backed by createRateLimiterAsync (Upstash when
// configured, in-memory fallback otherwise — neither env var is set in the
// test environment, so this exercises the fallback path).
describe("checkVerifyEmailRateLimit", () => {
  it("blocks once its limit is exhausted for a given key", async () => {
    const key = `test-ip-${Math.random()}`;
    let lastResult;
    for (let i = 0; i < 25; i++) lastResult = await checkVerifyEmailRateLimit(key);
    expect(lastResult?.allowed).toBe(false);
  });
});

describe("checkResendVerificationRateLimit", () => {
  it("blocks once its limit is exhausted for a given key", async () => {
    const key = `test-ip-email-${Math.random()}`;
    let lastResult;
    for (let i = 0; i < 5; i++) lastResult = await checkResendVerificationRateLimit(key);
    expect(lastResult?.allowed).toBe(false);
  });

  it("tracks a different email independently, even from the same IP", async () => {
    const ip = `test-ip-${Math.random()}`;
    for (let i = 0; i < 3; i++) await checkResendVerificationRateLimit(`${ip}:victim-a@example.com`);
    expect((await checkResendVerificationRateLimit(`${ip}:victim-a@example.com`)).allowed).toBe(false);
    expect((await checkResendVerificationRateLimit(`${ip}:victim-b@example.com`)).allowed).toBe(true);
  });
});
