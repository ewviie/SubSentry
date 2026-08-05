import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for the read/increment/lock cycle in lockout.ts —
// same real-Postgres pattern as subscriptions/queries.idor.test.ts, and for
// the same reason: "does a lock actually re-engage after it expires" isn't
// provable by reading the query builder calls, only by running them against
// real rows and real clock comparisons. Skips cleanly wherever DATABASE_URL
// isn't set, same as every other DB-integration test in this repo.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("lockout (DB integration)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let lockout: typeof import("./lockout");
  const testEmails: string[] = [];

  function freshEmail(): string {
    const email = `lockout-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    return email;
  }

  beforeEach(async () => {
    if (!db) {
      db = (await import("@/lib/db")).db;
      schema = await import("@/lib/db/schema");
      lockout = await import("./lockout");
    }
  });

  afterAll(async () => {
    if (!db || testEmails.length === 0) return;
    await db.delete(schema.loginAttempts).where(inArray(schema.loginAttempts.email, testEmails));
  });

  it("locks after LOCK_THRESHOLD failures and checkLockout reports it", async () => {
    const email = freshEmail();
    for (let i = 0; i < 5; i++) {
      await lockout.recordFailedLogin(email);
    }
    const status = await lockout.checkLockout(email);
    expect(status.locked).toBe(true);
  });

  it("re-locks on the first failure after a prior lock has expired (regression: used to permanently disable re-locking)", async () => {
    const email = freshEmail();
    for (let i = 0; i < 5; i++) {
      await lockout.recordFailedLogin(email);
    }
    let [row] = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.email, email))
      .limit(1);
    expect(row?.lockedUntil).not.toBeNull();

    // Simulate the lock having already expired (15 minutes ago) — this is
    // exactly the state a real account is in once its lock window passes.
    await db
      .update(schema.loginAttempts)
      .set({ lockedUntil: new Date(Date.now() - 60_000) })
      .where(eq(schema.loginAttempts.email, email));

    // checkLockout must treat a past lockedUntil as not-locked.
    const statusAfterExpiry = await lockout.checkLockout(email);
    expect(statusAfterExpiry.locked).toBe(false);

    // One more failure past the (already-exceeded) threshold must re-engage
    // the lock, not silently leave the stale, expired lockedUntil in place.
    await lockout.recordFailedLogin(email);
    [row] = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.email, email))
      .limit(1);
    expect(row?.lockedUntil).not.toBeNull();
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const statusAfterRelock = await lockout.checkLockout(email);
    expect(statusAfterRelock.locked).toBe(true);
  });

  it("resetLoginAttempts clears both the count and the lock", async () => {
    const email = freshEmail();
    for (let i = 0; i < 5; i++) {
      await lockout.recordFailedLogin(email);
    }
    expect((await lockout.checkLockout(email)).locked).toBe(true);

    await lockout.resetLoginAttempts(email);

    const status = await lockout.checkLockout(email);
    expect(status.locked).toBe(false);
    expect(status.delayMs).toBe(0);
  });

  it("deleteStaleLoginAttempts leaves recent rows alone", async () => {
    const email = freshEmail();
    await lockout.recordFailedLogin(email);

    await lockout.deleteStaleLoginAttempts();

    const [row] = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.email, email))
      .limit(1);
    expect(row).toBeDefined();
  });

  it("deleteStaleLoginAttempts removes rows older than the retention window", async () => {
    const email = freshEmail();
    await lockout.recordFailedLogin(email);
    await db
      .update(schema.loginAttempts)
      .set({ updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.loginAttempts.email, email));

    await lockout.deleteStaleLoginAttempts();

    const [row] = await db
      .select()
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.email, email))
      .limit(1);
    expect(row).toBeUndefined();
  });
});
