import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration tests for the email verification token lifecycle — same
// justification and skip-when-no-DB pattern as
// src/lib/subscriptions/queries.idor.test.ts: token issuance/consumption is
// a real INSERT/SELECT/DELETE sequence, not provable by reading the
// function body alone.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("email verification token lifecycle", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let verification: typeof import("./email-verification");
  let userId: string;

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    verification = await import("./email-verification");

    const [user] = await db
      .insert(schema.users)
      .values({
        email: `verify-test-${Date.now()}@example.com`,
        passwordHash: "test-hash-not-real",
        emailVerified: false,
      })
      .returning();
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(schema.users).where(inArray(schema.users.id, [userId]));
  });

  it("valid token: verifies the user and deletes the token", async () => {
    const { rawToken } = await verification.issueVerificationToken(userId);

    const result = await verification.consumeVerificationToken(rawToken);
    expect(result).toEqual({ ok: true, userId });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifiedAt).not.toBeNull();

    const remaining = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, userId));
    expect(remaining).toHaveLength(0);
  });

  it("reused token: a second attempt with the same (already-consumed) token fails", async () => {
    const { rawToken } = await verification.issueVerificationToken(userId);

    const first = await verification.consumeVerificationToken(rawToken);
    expect(first.ok).toBe(true);

    const second = await verification.consumeVerificationToken(rawToken);
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  it("invalid token: a token that was never issued is rejected", async () => {
    const result = await verification.consumeVerificationToken("this-token-was-never-issued-abc123");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("expired token: rejected, and the expired row is deleted so it can't be retried", async () => {
    const { rawToken } = await verification.issueVerificationToken(userId);

    // Directly backdate the row's expiry — issueVerificationToken always
    // sets a real 24h-out expiry, so this simulates "24h later" without a
    // fake timer.
    await db
      .update(schema.emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.emailVerificationTokens.userId, userId));

    const result = await verification.consumeVerificationToken(rawToken);
    expect(result).toEqual({ ok: false, reason: "expired" });

    // Confirmed deleted, not just expired-but-present — a second attempt
    // with the same token must also fail, and for the same reason
    // (invalid, since the row is gone), not silently succeed.
    const secondAttempt = await verification.consumeVerificationToken(rawToken);
    expect(secondAttempt).toEqual({ ok: false, reason: "invalid" });
  });

  it("concurrent consumption of the same token: exactly one of many simultaneous attempts succeeds", async () => {
    // Regression test for a real race found on independent re-review: the
    // original implementation did SELECT-then-DELETE inside a db.transaction
    // and claimed that prevented two concurrent requests (e.g. an email
    // client prefetching the same link twice) from both treating the token
    // as valid. That claim was false under Postgres's default READ COMMITTED
    // isolation — a plain SELECT takes no row lock, so both could read the
    // row before either's DELETE committed. Fixed by claiming the row with a
    // single atomic `DELETE ... RETURNING` instead. This test fires many
    // concurrent consume attempts at the same token and asserts only one
    // ever succeeds — the previous implementation could fail this under load.
    const { rawToken } = await verification.issueVerificationToken(userId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => verification.consumeVerificationToken(rawToken)),
    );

    const successes = results.filter((r) => r.ok);
    expect(successes).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "invalid")).toHaveLength(9);
  });

  it("issuing a new token invalidates any previous outstanding token for the same user", async () => {
    const first = await verification.issueVerificationToken(userId);
    const second = await verification.issueVerificationToken(userId);

    const firstResult = await verification.consumeVerificationToken(first.rawToken);
    expect(firstResult).toEqual({ ok: false, reason: "invalid" });

    const secondResult = await verification.consumeVerificationToken(second.rawToken);
    expect(secondResult).toEqual({ ok: true, userId });
  });

  it("concurrent issuance for the same user: exactly one row and one valid token survive, never two", async () => {
    // Regression test for a race in the old delete-then-insert
    // implementation: two concurrent issueVerificationToken calls (e.g. a
    // double-clicked resend) could each run their DELETE before the other's
    // INSERT landed, leaving two valid rows/tokens for one user instead of
    // one. Now backed by an upsert on emailVerificationTokens' unique
    // userId column, so Postgres serializes the two ON CONFLICT writes —
    // this asserts that outcome, not just the single-call happy path above.
    const [first, second] = await Promise.all([
      verification.issueVerificationToken(userId),
      verification.issueVerificationToken(userId),
    ]);

    const rows = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, userId));
    expect(rows).toHaveLength(1);

    const results = await Promise.all([
      verification.consumeVerificationToken(first.rawToken),
      verification.consumeVerificationToken(second.rawToken),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
