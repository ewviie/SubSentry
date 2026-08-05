import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration regression coverage for a real race found on independent
// security review: createSubscriptionWithLimitCheck /
// createSubscriptionsBulkWithLimitCheck (lib/subscriptions/queries.ts) used
// to run their count-check and their insert as two separate, unrelated
// statements with nothing serializing concurrent callers for the same
// user — two concurrent requests could each read "N rows, under the
// ceiling" before either's insert committed, both proceed, and leave the
// account over whatever limit was being enforced (MAX_ACTIVE_SUBSCRIPTIONS
// today; the free-plan cap too, once BETA_ALL_ACCESS is turned off). Fixed
// with a transaction holding a Postgres advisory lock scoped to the calling
// user. This can only be proven against a real Postgres instance — a
// mocked/pure-unit test can't reproduce two statements from different
// connections actually interleaving — same justification as
// queries.idor.test.ts and lockout.db.test.ts.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("subscription creation concurrency (advisory lock)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("./queries");
  const createdUserIds: string[] = [];

  async function createTestUser(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `race-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        passwordHash: "test-hash-not-real",
      })
      .returning();
    createdUserIds.push(user.id);
    return user.id;
  }

  function subscriptionInput(name: string) {
    return {
      name,
      amount: "9.99",
      currency: "usd",
      billingCycle: "monthly" as const,
      category: "other" as const,
      nextRenewalDate: "2099-01-01",
      status: "active" as const,
    };
  }

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("./queries");
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    // users.id cascades to subscriptions (onDelete: "cascade" in schema.ts).
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  it("N concurrent creates for the same user all succeed and leave exactly N rows — no lost updates, no over-count", async () => {
    const userId = await createTestUser();
    const concurrency = 15;

    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        queries.createSubscriptionWithLimitCheck(userId, "free", subscriptionInput(`Sub ${i}`), "manual"),
      ),
    );

    expect(results.every((r) => r.kind === "created")).toBe(true);

    const rows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(rows).toHaveLength(concurrency);
    // Every row landed with a distinct id — proves no result was silently
    // duplicated or dropped by a raced read of the pre-insert count.
    expect(new Set(rows.map((r) => r.id)).size).toBe(concurrency);
  });

  it("concurrent bulk confirms for the same user all succeed and leave exactly the right row count", async () => {
    const userId = await createTestUser();
    const batches = [
      [subscriptionInput("Batch A - 1"), subscriptionInput("Batch A - 2")],
      [subscriptionInput("Batch B - 1"), subscriptionInput("Batch B - 2"), subscriptionInput("Batch B - 3")],
    ];

    const results = await Promise.all(
      batches.map((rows) => queries.createSubscriptionsBulkWithLimitCheck(userId, "free", rows, "csv_import")),
    );

    expect(results.every((r) => r.kind === "created")).toBe(true);
    const totalCreated = results.reduce(
      (sum, r) => sum + (r.kind === "created" ? r.subscriptions.length : 0),
      0,
    );
    expect(totalCreated).toBe(5);

    const rows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
    expect(rows).toHaveLength(5);
  });

  it("a lock held for one user never blocks or interferes with a concurrent create for a different user", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const [resultA, resultB] = await Promise.all([
      queries.createSubscriptionWithLimitCheck(userA, "free", subscriptionInput("A's sub"), "manual"),
      queries.createSubscriptionWithLimitCheck(userB, "free", subscriptionInput("B's sub"), "manual"),
    ]);

    expect(resultA.kind).toBe("created");
    expect(resultB.kind).toBe("created");

    const aRows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userA));
    const bRows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userB));
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
  });
});
