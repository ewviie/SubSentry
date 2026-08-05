import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";

// IDOR regression coverage for the ownership-scoping pattern every
// subscriptions/[id] route handler relies on (getSubscription/
// updateSubscription/deleteSubscription all take `userId` and only ever
// match a row where BOTH userId and id agree — see schema.ts). This is the
// one test file in the repo that talks to a real Postgres instance rather
// than testing a pure function; every other suite here is pure-unit. It's
// worth the exception because "does another user's session ever reach my
// row" isn't provable by reading the query builder call — it has to be
// proven against a real WHERE clause. Skips cleanly wherever DATABASE_URL
// isn't set (this repo has no CI yet — see PROJECT_SECURITY_MAP.md) rather
// than failing the suite.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("subscription ownership scoping (IDOR)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("@/lib/subscriptions/queries");
  let userA: string;
  let userB: string;
  let subA: string;
  // Tracked incrementally (pushed right after each insert succeeds) rather
  // than read back from userA/userB in afterAll — if userB's insert throws,
  // userA/userB would otherwise be evaluated as [<real id>, undefined] by
  // inArray, which either no-ops or throws depending on the driver and
  // either masks the real setup failure or leaves userA's row behind.
  // Cleaning up exactly what was actually created avoids both.
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("@/lib/subscriptions/queries");

    const stamp = Date.now();
    const [a] = await db
      .insert(schema.users)
      .values({ email: `idor-test-a-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userA = a.id;
    createdUserIds.push(userA);

    const [b] = await db
      .insert(schema.users)
      .values({ email: `idor-test-b-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userB = b.id;
    createdUserIds.push(userB);

    const created = await queries.createSubscription(userA, {
      name: "User A's Private Subscription",
      amount: "9.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    subA = created.id;
  });

  afterAll(async () => {
    // users.id cascades to subscriptions (onDelete: "cascade" in schema.ts),
    // so deleting whichever test users were actually created is sufficient
    // cleanup — no need to separately track/delete subA.
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  it("getSubscription: user B cannot read user A's subscription by its real id", async () => {
    const result = await queries.getSubscription(userB, subA);
    expect(result).toBeUndefined();
  });

  it("getSubscription: user A can read their own subscription", async () => {
    const result = await queries.getSubscription(userA, subA);
    expect(result?.id).toBe(subA);
  });

  it("updateSubscription: user B's update against user A's id is a no-op (returns undefined, does not mutate)", async () => {
    const result = await queries.updateSubscription(userB, subA, { name: "Hijacked" });
    expect(result).toBeUndefined();

    const stillOwnedByA = await queries.getSubscription(userA, subA);
    expect(stillOwnedByA?.name).toBe("User A's Private Subscription");
  });

  it("deleteSubscription: user B cannot delete user A's subscription", async () => {
    const deleted = await queries.deleteSubscription(userB, subA);
    expect(deleted).toBe(false);

    const stillExists = await queries.getSubscription(userA, subA);
    expect(stillExists).toBeDefined();
  });

  it("listSubscriptions: user B's list never includes user A's subscription", async () => {
    const bList = await queries.listSubscriptions(userB);
    expect(bList.some((s) => s.id === subA)).toBe(false);
  });
});
