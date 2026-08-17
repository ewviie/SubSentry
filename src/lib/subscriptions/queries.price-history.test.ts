import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";

// Real-DB coverage for the price-history write paths added in Phase 9 (see
// schema.ts's subscriptionPriceHistory comment for the "why"). Same
// exception-to-pure-unit-testing rationale queries.idor.test.ts documents
// on itself: whether a row actually lands in a second table on create/edit,
// and only when the price genuinely changed, isn't provable by reading the
// query builder call — it has to be proven against a real INSERT. Skips
// cleanly wherever DATABASE_URL isn't set, same as every other DB-backed
// suite in this repo.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("subscription price history", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("@/lib/subscriptions/queries");
  let userA: string;
  let userB: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("@/lib/subscriptions/queries");

    const stamp = Date.now();
    const [a] = await db
      .insert(schema.users)
      .values({ email: `price-history-a-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userA = a.id;
    createdUserIds.push(userA);

    const [b] = await db
      .insert(schema.users)
      .values({ email: `price-history-b-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userB = b.id;
    createdUserIds.push(userB);
  });

  afterAll(async () => {
    // Cascades through subscriptions -> subscription_price_history (both
    // declared onDelete: "cascade" in schema.ts), so deleting the two test
    // users is sufficient cleanup.
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  it("createSubscription writes exactly one 'initial' price-history row", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Initial Row Test",
      amount: "9.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ amountCents: 999, currency: "usd", source: "initial" });
  });

  it("updateSubscription with a genuine amount change writes a 'user_edit' row", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Price Change Test",
      amount: "10.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    await queries.updateSubscription(userA, sub.id, { amount: "15.00" });

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ amountCents: 1000, source: "initial" });
    expect(history[1]).toMatchObject({ amountCents: 1500, source: "user_edit" });
  });

  it("updateSubscription with only a billing-cycle change writes a 'user_edit' row (amountCents unchanged)", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Cycle Change Test",
      amount: "12.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    await queries.updateSubscription(userA, sub.id, { billingCycle: "yearly" });

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ billingCycle: "monthly", source: "initial" });
    expect(history[1]).toMatchObject({ amountCents: 1200, billingCycle: "yearly", source: "user_edit" });
  });

  it("updateSubscription resubmitting the same amount writes no new row", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "No-Op Amount Test",
      amount: "12.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    await queries.updateSubscription(userA, sub.id, { amount: "12.00" });

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(1);
  });

  it("updateSubscription touching only unrelated fields writes no new row", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Rename Only Test",
      amount: "8.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    await queries.updateSubscription(userA, sub.id, { name: "Renamed" });

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe("initial");
  });

  it("createSubscriptionsBulkWithLimitCheck writes one 'initial' row per created subscription", async () => {
    const result = await queries.createSubscriptionsBulkWithLimitCheck(
      userA,
      "pro",
      [
        {
          name: "Bulk A",
          amount: "5.00",
          currency: "usd",
          billingCycle: "monthly",
          category: "other",
          nextRenewalDate: "2099-01-01",
          status: "active",
        },
        {
          name: "Bulk B",
          amount: "6.00",
          currency: "usd",
          billingCycle: "monthly",
          category: "other",
          nextRenewalDate: "2099-01-01",
          status: "active",
        },
      ],
      "csv_import",
    );
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected created");

    for (const sub of result.subscriptions) {
      const history = await queries.getPriceHistory(userA, sub.id);
      expect(history).toHaveLength(1);
      expect(history[0].source).toBe("initial");
    }
  });

  it("getPriceHistory: user B cannot read user A's price history by subscription id", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Scoping Test",
      amount: "20.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const asOwner = await queries.getPriceHistory(userA, sub.id);
    const asOther = await queries.getPriceHistory(userB, sub.id);
    expect(asOwner).toHaveLength(1);
    expect(asOther).toHaveLength(0);
  });
});
