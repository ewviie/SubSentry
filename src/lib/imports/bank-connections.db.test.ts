import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";

// DB-integration coverage for deleteBankConnection's ownership scoping —
// the self-service Plaid/TrueLayer disconnect fix (see
// api/imports/{plaid,truelayer}/disconnect). Same reasoning as
// subscriptions/queries.idor.test.ts: "does disconnecting my own bank
// connection ever remove someone else's row" isn't provable by reading the
// query builder call, only by running it against real rows. Skips cleanly
// wherever DATABASE_URL isn't set, same as every other DB-integration test
// in this repo.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("deleteBankConnection ownership scoping", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let bankConnections: typeof import("./bank-connections");
  let userA: string;
  let userB: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    bankConnections = await import("./bank-connections");

    const stamp = Date.now();
    const [a] = await db
      .insert(schema.users)
      .values({ email: `bankconn-test-a-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userA = a.id;
    createdUserIds.push(userA);

    const [b] = await db
      .insert(schema.users)
      .values({ email: `bankconn-test-b-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userB = b.id;
    createdUserIds.push(userB);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Cascades to any bank_connections rows this suite failed to clean up
      // itself (schema.ts: onDelete: "cascade") — belt and suspenders.
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    }
  });

  it("only deletes the target user's connections for that provider, leaving another user's untouched", async () => {
    await bankConnections.createBankConnection({
      userId: userA,
      provider: "plaid",
      // randomUUID(), not Date.now() — two providerItemId values generated
      // back-to-back in the same test can otherwise land on the same
      // millisecond and collide against the (userId, provider,
      // providerItemId) unique index (schema.ts), failing the insert
      // instead of testing the property this suite actually cares about.
      providerItemId: `item-a-${randomUUID()}`,
      institutionName: "User A's Bank",
      accessToken: "plaintext-token-a",
    });
    await bankConnections.createBankConnection({
      userId: userB,
      provider: "plaid",
      providerItemId: `item-b-${randomUUID()}`,
      institutionName: "User B's Bank",
      accessToken: "plaintext-token-b",
    });

    const deleted = await bankConnections.deleteBankConnection(userA, "plaid");
    expect(deleted).toHaveLength(1);
    expect(deleted[0].userId).toBe(userA);

    expect(await bankConnections.listBankConnections(userA)).toHaveLength(0);
    // User B's connection must still exist — disconnecting A's Plaid must
    // never touch B's row.
    const bStillConnected = await bankConnections.listBankConnections(userB);
    expect(bStillConnected).toHaveLength(1);
    expect(bStillConnected[0].institutionName).toBe("User B's Bank");
  });

  it("deletes every connection the target user has for that provider (multi-institution disconnect)", async () => {
    await bankConnections.createBankConnection({
      userId: userA,
      provider: "truelayer",
      providerItemId: `tl-item-1-${randomUUID()}`,
      institutionName: "Bank One",
      accessToken: "plaintext-token-1",
    });
    await bankConnections.createBankConnection({
      userId: userA,
      provider: "truelayer",
      providerItemId: `tl-item-2-${randomUUID()}`,
      institutionName: "Bank Two",
      accessToken: "plaintext-token-2",
    });

    const deleted = await bankConnections.deleteBankConnection(userA, "truelayer");
    expect(deleted).toHaveLength(2);
    expect(await bankConnections.listBankConnections(userA)).toHaveLength(0);
  });

  it("returns an empty array (not an error) when there is nothing to disconnect", async () => {
    const deleted = await bankConnections.deleteBankConnection(userA, "plaid");
    expect(deleted).toEqual([]);
  });
});
