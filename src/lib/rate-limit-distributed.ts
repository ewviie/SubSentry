import { createRateLimiter, type RateLimitResult } from "./rate-limit";

// Every existing limiter in this app (src/lib/{auth,billing,imports,subscriptions,ai}/rate-limit.ts)
// is in-memory and per-process — correct for shedding accidental abuse from
// a single instance, but it resets on restart and doesn't share state
// across horizontally-scaled instances (documented in
// SECURITY_HARDENING_REPORT.md as a known, accepted gap). This module adds
// a distributed alternative for the highest-value auth surfaces
// (login/signup/verify/resend — the ones a real distributed attacker would
// actually target across many instances) without requiring a new SDK
// dependency: Upstash's REST API is plain HTTP, called via fetch(), the
// same pattern already used for Resend (src/lib/auth/email.ts) and
// TrueLayer (src/lib/imports/truelayer-client.ts).
//
// Same "leave the env unset, degrade gracefully" convention as every other
// optional integration in this app: absent UPSTASH_REDIS_REST_URL/TOKEN
// falls back to the existing in-memory limiter, wrapped to present the
// same async interface either way so call sites don't need to branch.
export function isDistributedRateLimitConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// Bounds how long a login/signup request can be held up waiting on Upstash
// before giving up and falling back to the in-memory limiter — without
// this, a network partition or a hung Upstash endpoint would stall every
// auth request indefinitely instead of degrading to the (still real, just
// weaker) fallback protection the try/catch below exists to provide.
const UPSTASH_TIMEOUT_MS = 2000;

// Fixed-window counter via Upstash's REST pipeline endpoint: INCR the key,
// and only on the very first increment (count === 1) set its expiry — an
// atomic pipeline avoids a separate round trip racing a concurrent
// request's own increment into setting the wrong expiry twice.
async function checkUpstash(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const windowSeconds = Math.ceil(windowMs / 1000);
  const redisKey = `ratelimit:${key}`;

  const response = await fetch(`${baseUrl}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, windowSeconds, "NX"], // NX: only set TTL if the key has none yet
    ]),
    signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Upstash rate limit request failed: ${response.status}`);
  }

  const body = (await response.json()) as unknown;
  // Upstash's pipeline endpoint returns 200 with an `{error}` entry (a
  // command error, e.g. a type mismatch on the key) instead of the expected
  // `{result}` shape — that's a well-formed HTTP response, so the `!response.ok`
  // check above never catches it. Left unvalidated, `count` becomes
  // `undefined`, every comparison against it evaluates false, and the
  // caller silently gets `{allowed: false}` for every request — a
  // self-inflicted denial of service on login/signup, indistinguishable
  // from a real rate limit, instead of the intended fallback below.
  const count = Array.isArray(body) ? (body[0] as { result?: unknown } | undefined)?.result : undefined;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new Error("Upstash rate limit response was malformed (no numeric result)");
  }

  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export function createRateLimiterAsync(limit: number, windowMs: number): (key: string) => Promise<RateLimitResult> {
  // Kept as the fallback implementation, not a separate code path callers
  // need to know about — same limit/window, just backed by memory instead
  // of Redis when Upstash isn't configured.
  const memoryFallback = createRateLimiter(limit, windowMs);

  return async (key: string): Promise<RateLimitResult> => {
    if (!isDistributedRateLimitConfigured()) {
      return memoryFallback(key);
    }
    try {
      return await checkUpstash(key, limit, windowMs);
    } catch {
      // A Redis outage should degrade to "still rate-limited by this
      // instance's own memory," not "no rate limiting at all" — failing
      // open on the one layer meant to stop brute-force abuse would be
      // worse than falling back to the weaker (but non-zero) protection.
      return memoryFallback(key);
    }
  };
}
