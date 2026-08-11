import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration tests for the password-reset token lifecycle — same
// justification and skip-when-no-DB pattern as
// src/lib/subscriptions/queries.idor.test.ts and
// src/lib/auth/email-verification.test.ts: token issuance/consumption is a
// real INSERT/SELECT/DELETE sequence, not provable by reading the function
// body alone.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("password reset token lifecycle", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let passwordReset: typeof import("./password-reset");
  let userId: string;
  let originalPasswordHash: string;

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    passwordReset = await import("./password-reset");

    originalPasswordHash = "original-hash-not-real";
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `reset-test-${Date.now()}@example.com`,
        passwordHash: originalPasswordHash,
      })
      .returning();
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(schema.users).where(inArray(schema.users.id, [userId]));
  });

  it("valid token: sets a new password hash and deletes the token", async () => {
    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);

    const result = await passwordReset.consumePasswordResetToken(rawToken, "a-brand-new-password-1");
    expect(result).toEqual({ ok: true, userId });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(user.passwordHash).not.toBe(originalPasswordHash);
    // A real argon2id hash, not the plaintext password stored directly.
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.passwordHash).not.toContain("a-brand-new-password-1");

    const remaining = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.userId, userId));
    expect(remaining).toHaveLength(0);
  });

  it("consuming a token deletes every existing session for that user", async () => {
    // Two fabricated session rows — the reset flow must revoke all of
    // them, not just the one belonging to whatever browser clicked the
    // link, since the whole point is invalidating a possibly-stolen
    // session the account owner doesn't even know about.
    await db.insert(schema.sessions).values([
      { tokenHash: `fake-session-hash-a-${Date.now()}`, userId, expiresAt: new Date(Date.now() + 86_400_000) },
      { tokenHash: `fake-session-hash-b-${Date.now()}`, userId, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);

    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);
    const result = await passwordReset.consumePasswordResetToken(rawToken, "another-new-password-2");
    expect(result.ok).toBe(true);

    const remainingSessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
    expect(remainingSessions).toHaveLength(0);
  });

  it("reused token: a second attempt with the same (already-consumed) token fails", async () => {
    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);

    const first = await passwordReset.consumePasswordResetToken(rawToken, "third-new-password-3");
    expect(first.ok).toBe(true);

    const second = await passwordReset.consumePasswordResetToken(rawToken, "fourth-new-password-4");
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  it("invalid token: a token that was never issued is rejected", async () => {
    const result = await passwordReset.consumePasswordResetToken(
      "this-token-was-never-issued-abc123",
      "fifth-new-password-5",
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("expired token: rejected, and the expired row is deleted so it can't be retried", async () => {
    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);

    // Directly backdate the row's expiry — issuePasswordResetToken always
    // sets a real 1h-out expiry, so this simulates "an hour later" without
    // a fake timer.
    await db
      .update(schema.passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.passwordResetTokens.userId, userId));

    const result = await passwordReset.consumePasswordResetToken(rawToken, "sixth-new-password-6");
    expect(result).toEqual({ ok: false, reason: "expired" });

    // Confirmed deleted, not just expired-but-present — a second attempt
    // with the same token must also fail, and for the same reason
    // (invalid, since the row is gone), not silently succeed.
    const secondAttempt = await passwordReset.consumePasswordResetToken(rawToken, "seventh-new-password-7");
    expect(secondAttempt).toEqual({ ok: false, reason: "invalid" });
  });

  it("an expired token does not change the password or touch sessions", async () => {
    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);

    // A real session row, so "does not touch sessions" below is checked
    // against actual data rather than an always-empty table — the earlier
    // version of this test asserted the password only, despite its own
    // name, and would have passed even if consumePasswordResetToken wiped
    // every session on an expired token.
    await db.insert(schema.sessions).values({
      tokenHash: `fake-session-hash-expired-${Date.now()}`,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);
    await db
      .update(schema.passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.passwordResetTokens.userId, userId));

    await passwordReset.consumePasswordResetToken(rawToken, "eighth-new-password-8");

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(after.passwordHash).toBe(before.passwordHash);

    const sessionsAfter = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
    expect(sessionsAfter).toHaveLength(1);
  });

  it("a failure partway through the operation rolls back everything, including the token claim — the token is not burned", async () => {
    // Regression test for the exact bug this atomicity fix closes: the
    // token DELETE used to commit on its own, separately from hashing the
    // new password and writing it. If hashing (or anything after the
    // DELETE) failed, the token was already gone forever with the
    // password never actually changed. Simulating that same failure point
    // (hashPassword rejecting) here, now that everything runs in one
    // transaction, proves the DELETE rolls back along with it.
    const passwordModule = await import("./password");
    const hashSpy = vi
      .spyOn(passwordModule, "hashPassword")
      .mockRejectedValueOnce(new Error("simulated hashing failure"));

    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);

    // try/finally, not a bare mockRestore() after the assertions below —
    // if any of those assertions throws, a bare call after them would never
    // run, leaving hashSpy's rejection mocked for hashPassword in every
    // later test in this file (and anything else importing that module in
    // the same worker) instead of just this one.
    try {
      await expect(passwordReset.consumePasswordResetToken(rawToken, "should-never-be-set-1")).rejects.toThrow(
        "simulated hashing failure",
      );

      // Password untouched — the failed attempt must not have partially
      // applied.
      const [afterFailure] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      expect(afterFailure.passwordHash).toBe(before.passwordHash);

      // The token itself must still exist in the table — not silently
      // consumed by the DELETE that was supposed to roll back.
      const remaining = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, userId));
      expect(remaining).toHaveLength(1);
    } finally {
      hashSpy.mockRestore();
    }

    // And it must still genuinely work, not just be present-but-dead —
    // the real proof that this is a full rollback, not a partial one.
    // Deliberately outside the try above: this call needs the *real*
    // hashPassword, so it must run only after the mock is restored.
    const retry = await passwordReset.consumePasswordResetToken(rawToken, "recovered-password-after-failure");
    expect(retry).toEqual({ ok: true, userId });

    const [afterRetry] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(afterRetry.passwordHash).not.toBe(before.passwordHash);
  });

  it("concurrent consumption of the same token: exactly one of many simultaneous attempts succeeds", async () => {
    // Same regression coverage as email-verification.test.ts's identical
    // test — this token type is claimed via the same atomic
    // DELETE...RETURNING pattern, not SELECT-then-DELETE.
    const { rawToken } = await passwordReset.issuePasswordResetToken(userId);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => passwordReset.consumePasswordResetToken(rawToken, `concurrent-pw-${i}`)),
    );

    const successes = results.filter((r) => r.ok);
    expect(successes).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "invalid")).toHaveLength(9);
  });

  it("issuing a new token invalidates any previous outstanding token for the same user", async () => {
    const first = await passwordReset.issuePasswordResetToken(userId);
    const second = await passwordReset.issuePasswordResetToken(userId);

    const firstResult = await passwordReset.consumePasswordResetToken(first.rawToken, "ninth-new-password-9");
    expect(firstResult).toEqual({ ok: false, reason: "invalid" });

    const secondResult = await passwordReset.consumePasswordResetToken(second.rawToken, "tenth-new-password-10");
    expect(secondResult).toEqual({ ok: true, userId });
  });

  it("concurrent issuance for the same user: exactly one row survives, never two", async () => {
    const [first, second] = await Promise.all([
      passwordReset.issuePasswordResetToken(userId),
      passwordReset.issuePasswordResetToken(userId),
    ]);

    const rows = await db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.userId, userId));
    expect(rows).toHaveLength(1);

    const results = await Promise.all([
      passwordReset.consumePasswordResetToken(first.rawToken, "eleventh-new-password-11"),
      passwordReset.consumePasswordResetToken(second.rawToken, "twelfth-new-password-12"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
