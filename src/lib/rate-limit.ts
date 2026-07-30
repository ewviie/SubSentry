// In-memory, per-process rate limiting. Deliberately not DB-backed: it
// resets on server restart and doesn't share state across serverless
// instances, which is a real limitation, not an oversight — each limiter
// built from this exists to stop accidental abuse (retry loops,
// credential-stuffing scripts) from a single process's point of view, not
// to defend against a determined distributed attacker. Upgrade to a DB or
// Redis-backed limiter before that's the real threat model.
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Bounds the map's size on a long-running process — without this, every
  // distinct key (user, IP, etc.) that has ever hit this limiter leaves a
  // bucket behind forever, since a bucket is only ever touched (and could
  // be pruned) by that same key's next call. Swept at most once per
  // window, not on every call, so this stays cheap.
  let lastSweepAt = 0;

  function sweepExpired(now: number): void {
    if (now - lastSweepAt < windowMs) return;
    lastSweepAt = now;
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  return function checkAndConsume(key: string): RateLimitResult {
    const now = Date.now();
    sweepExpired(now);
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1 };
    }

    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count };
  };
}
