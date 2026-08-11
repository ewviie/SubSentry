import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for deleteUserAndAllData — same real-Postgres
// pattern as subscriptions/queries.idor.test.ts and
// imports/bank-connections.db.test.ts, and for the same reason: "does
// deleting my account actually remove every table I own, and leave another
// user's rows untouched" isn't provable by reading the query builder call
// (a single `db.transaction` around a `delete(users)` — see
// account-deletion.ts's own comment on why that's enough for every
// cascade-declared table), only by running it against real rows in every
// affected table. Skips cleanly wherever DATABASE_URL isn't set, same as
// every other DB-integration test in this repo.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("deleteUserAndAllData", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let accountDeletion: typeof import("./account-deletion");
  let userA: string;
  let userAEmail: string;
  let userB: string;
  let userBEmail: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    accountDeletion = await import("./account-deletion");

    const stamp = Date.now();
    userAEmail = `account-delete-test-a-${stamp}@example.com`;
    userBEmail = `account-delete-test-b-${stamp}@example.com`;

    const [a] = await db
      .insert(schema.users)
      .values({ email: userAEmail, passwordHash: "test-hash-not-real" })
      .returning();
    userA = a.id;
    createdUserIds.push(userA);

    const [b] = await db
      .insert(schema.users)
      .values({ email: userBEmail, passwordHash: "test-hash-not-real" })
      .returning();
    userB = b.id;
    createdUserIds.push(userB);

    // One row per user-owned table, for BOTH users — proves the deletion
    // both (a) removes every table it's supposed to for the deleted user
    // and (b) never touches the other user's identical rows.
    for (const [userId, email] of [
      [userA, userAEmail],
      [userB, userBEmail],
    ] as const) {
      await db.insert(schema.sessions).values({
        tokenHash: `test-session-hash-${userId}`,
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await db.insert(schema.subscriptions).values({
        userId,
        name: "Test Sub",
        amountCents: 999,
        billingCycle: "monthly",
        nextRenewalDate: "2030-01-01",
      });
      await db.insert(schema.imports).values({
        userId,
        source: "csv_import",
        status: "completed",
      });
      await db.insert(schema.bankConnections).values({
        userId,
        provider: "truelayer",
        providerItemId: `test-item-${userId}`,
        institutionName: "Test Bank",
        accessTokenEncrypted: "test-ciphertext-not-real",
      });
      await db.insert(schema.emailConnections).values({
        userId,
        provider: "gmail",
        emailAddress: `mailbox-${userId}@example.com`,
        accessTokenEncrypted: "test-ciphertext-not-real",
      });
      await db.insert(schema.emailVerificationTokens).values({
        userId,
        tokenHash: `test-verify-hash-${userId}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await db.insert(schema.passwordResetTokens).values({
        userId,
        tokenHash: `test-reset-hash-${userId}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await db.insert(schema.loginAttempts).values({ email, failedCount: 2 });
    }
  });

  afterAll(async () => {
    // Belt and suspenders: cascades away anything this suite (or a failing
    // assertion partway through it) left behind. userA is expected to
    // already be gone by the time this runs.
    if (createdUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    }
    await db.delete(schema.loginAttempts).where(inArray(schema.loginAttempts.email, [userAEmail, userBEmail]));
  });

  it("removes the deleted user and every row they own, across every user-owned table, with none left orphaned", async () => {
    await accountDeletion.deleteUserAndAllData(userA, userAEmail);

    const [deletedUser] = await db.select().from(schema.users).where(eq(schema.users.id, userA)).limit(1);
    expect(deletedUser).toBeUndefined();

    const [sessionsLeft, subsLeft, importsLeft, bankLeft, emailLeft, verifyLeft, resetLeft, loginLeft] =
      await Promise.all([
        db.select().from(schema.sessions).where(eq(schema.sessions.userId, userA)),
        db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userA)),
        db.select().from(schema.imports).where(eq(schema.imports.userId, userA)),
        db.select().from(schema.bankConnections).where(eq(schema.bankConnections.userId, userA)),
        db.select().from(schema.emailConnections).where(eq(schema.emailConnections.userId, userA)),
        db.select().from(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, userA)),
        db.select().from(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, userA)),
        db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.email, userAEmail)),
      ]);

    expect(sessionsLeft).toHaveLength(0);
    expect(subsLeft).toHaveLength(0);
    expect(importsLeft).toHaveLength(0);
    expect(bankLeft).toHaveLength(0);
    expect(emailLeft).toHaveLength(0);
    expect(verifyLeft).toHaveLength(0);
    expect(resetLeft).toHaveLength(0);
    expect(loginLeft).toHaveLength(0);
  });

  it("never touches another user's account or data (no cross-account deletion)", async () => {
    // userA was already deleted by the previous test in this file — this
    // asserts userB's identical set of rows, inserted in the same
    // beforeAll, survived that call completely untouched.
    const [survivingUser] = await db.select().from(schema.users).where(eq(schema.users.id, userB)).limit(1);
    expect(survivingUser).toBeDefined();

    const [sessionsLeft, subsLeft, importsLeft, bankLeft, emailLeft, verifyLeft, resetLeft, loginLeft] =
      await Promise.all([
        db.select().from(schema.sessions).where(eq(schema.sessions.userId, userB)),
        db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userB)),
        db.select().from(schema.imports).where(eq(schema.imports.userId, userB)),
        db.select().from(schema.bankConnections).where(eq(schema.bankConnections.userId, userB)),
        db.select().from(schema.emailConnections).where(eq(schema.emailConnections.userId, userB)),
        db.select().from(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, userB)),
        db.select().from(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, userB)),
        db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.email, userBEmail)),
      ]);

    expect(sessionsLeft).toHaveLength(1);
    expect(subsLeft).toHaveLength(1);
    expect(importsLeft).toHaveLength(1);
    expect(bankLeft).toHaveLength(1);
    expect(emailLeft).toHaveLength(1);
    expect(verifyLeft).toHaveLength(1);
    expect(resetLeft).toHaveLength(1);
    expect(loginLeft).toHaveLength(1);
  });
});
