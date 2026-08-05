import { eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

// DB-backed brute-force lockout, keyed by email — survives a process
// restart and is shared across horizontally-scaled instances, unlike
// src/lib/auth/rate-limit.ts's in-memory limiters (which stay in place as a
// coarser, cheaper first line of defense; this is the durable one).
//
// Progressive response, not an instant hard lock: a handful of genuine
// typos shouldn't cost a real user anything noticeable, but a scripted
// credential-stuffing run against one account should get measurably slower
// and then blocked outright.
const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

// Attempt count -> artificial delay (ms) applied BEFORE the password is
// even checked, so the delay lands regardless of whether this attempt's
// guess turns out right or wrong. Exported for unit testing — the DB-backed
// read/increment/lock path around it has its own DB-integration coverage in
// lockout.db.test.ts (same real-Postgres pattern as
// subscriptions/queries.idor.test.ts), not just manual verification.
export function delayForAttempt(priorFailedCount: number): number {
  if (priorFailedCount >= 4) return 4000;
  if (priorFailedCount >= 2) return 1500;
  return 0;
}

export interface LockoutStatus {
  locked: boolean;
  delayMs: number;
}

export async function checkLockout(email: string): Promise<LockoutStatus> {
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email)).limit(1);
  if (!row) return { locked: false, delayMs: 0 };

  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { locked: true, delayMs: 0 };
  }

  return { locked: false, delayMs: delayForAttempt(row.failedCount) };
}

// Upsert: increments failedCount atomically (SQL-side, not read-then-write)
// so two concurrent failed attempts against the same email can't race and
// silently lose an increment. Locks once the post-increment count reaches
// the threshold.
export async function recordFailedLogin(email: string): Promise<void> {
  await db
    .insert(loginAttempts)
    .values({ email, failedCount: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: loginAttempts.email,
      set: {
        failedCount: sql`${loginAttempts.failedCount} + 1`,
        updatedAt: new Date(),
      },
    });

  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email)).limit(1);
  // A *future* lockedUntil means a lock is currently in force — leave it
  // alone. Once it's in the past (expired) it's stale, not active, so a
  // fresh threshold-reaching failure must be able to re-lock. The old
  // `!row.lockedUntil` check only asked "has this email ever been locked",
  // which is true forever after the first lock — every attempt after the
  // first lock's 15 minutes expired kept incrementing failedCount without
  // ever re-locking, silently disabling brute-force protection for that
  // email from then on.
  const lockActive = Boolean(row?.lockedUntil && row.lockedUntil.getTime() > Date.now());
  if (row && !lockActive && row.failedCount >= LOCK_THRESHOLD) {
    await db
      .update(loginAttempts)
      .set({ lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) })
      .where(eq(loginAttempts.email, email));
  }
}

export async function resetLoginAttempts(email: string): Promise<void> {
  await db
    .insert(loginAttempts)
    .values({ email, failedCount: 0, lockedUntil: null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: loginAttempts.email,
      set: { failedCount: 0, lockedUntil: null, updatedAt: new Date() },
    });
}

// Best-effort housekeeping, same shape as
// email-verification.ts's deleteExpiredVerificationTokens: one row per
// email that has ever failed a login accumulates forever with no TTL
// column of its own, so this bounds retention using the existing
// updatedAt (touched by every insert/update above) rather than adding a
// new column/migration for a single cleanup query. 30 days is generous —
// any row this old is either a long-since-resolved lockout or a one-off
// typo, never a still-relevant security signal. Not wired into any
// request path; intended for the same scheduled-job story as
// scripts/cleanup-expired-sessions.ts (see scripts/cleanup-stale-login-attempts.ts).
const STALE_ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function deleteStaleLoginAttempts(): Promise<void> {
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.updatedAt, new Date(Date.now() - STALE_ATTEMPT_RETENTION_MS)));
}
