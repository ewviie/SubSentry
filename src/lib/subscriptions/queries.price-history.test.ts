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

    await queries.updateSubscription(userA, sub.id, "free", { amount: "15.00" });

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

    await queries.updateSubscription(userA, sub.id, "free", { billingCycle: "yearly" });

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

    await queries.updateSubscription(userA, sub.id, "free", { amount: "12.00" });

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

    await queries.updateSubscription(userA, sub.id, "free", { name: "Renamed" });

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

  it("getAllPriceHistoryForUser: groups every subscription's history in one bulk query, scoped to the caller", async () => {
    const subA1 = await queries.createSubscription(userA, {
      name: "Bulk Test A1",
      amount: "10.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    const subA2 = await queries.createSubscription(userA, {
      name: "Bulk Test A2",
      amount: "20.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    // A genuine second row on subA1 — proves grouping doesn't just take the
    // first row per subscription.
    await queries.updateSubscription(userA, subA1.id, "free", { amount: "15.00" });

    await queries.createSubscription(userB, {
      name: "Bulk Test B",
      amount: "5.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const grouped = await queries.getAllPriceHistoryForUser(userA);
    expect(grouped.get(subA1.id)).toHaveLength(2);
    expect(grouped.get(subA2.id)).toHaveLength(1);
    // User B's row must never appear in user A's map, under any key —
    // not just "not under B's own subscription id" (that's the obvious
    // check) but genuinely absent from every value in the map.
    expect([...grouped.values()].flat().every((row) => row.userId === userA)).toBe(true);
  });

  // Import price-reconciliation: "Update price" (review-table.tsx) reuses
  // the exact same updateSubscription/PATCH path a manual edit does, tagged
  // with an optional priceHistorySource for provenance only — these prove
  // the tag actually lands on the written row, and that omitting it (every
  // pre-existing caller, including a plain manual edit) still defaults to
  // "user_edit" with zero behavior change.
  it("updateSubscription: tags the price-history row 'import_update' when the caller confirms an import-detected price change", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Import Update Test",
      amount: "15.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const result = await queries.updateSubscription(userA, sub.id, "free", {
      amount: "19.99",
      priceHistorySource: "import_update",
    });
    expect(result.kind).toBe("updated");

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ amountCents: 1999, source: "import_update" });
  });

  it("updateSubscription: a plain edit with no priceHistorySource ('Keep existing'/manual edit) still writes 'user_edit'", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Manual Edit Test",
      amount: "15.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const result = await queries.updateSubscription(userA, sub.id, "free", { amount: "19.99" });
    expect(result.kind).toBe("updated");

    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history[1]).toMatchObject({ amountCents: 1999, source: "user_edit" });
  });

  // Ownership isolation: the price-reconciliation PATCH reuses
  // updateSubscription's own userId-scoped WHERE clause unchanged — this
  // proves user B can't use the new priceHistorySource param as a side
  // door to write a price-history row (or touch the row at all) on a
  // subscription they don't own.
  it("updateSubscription: user B cannot use priceHistorySource to update or record history on user A's subscription", async () => {
    const sub = await queries.createSubscription(userA, {
      name: "Ownership Isolation Test",
      amount: "15.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const result = await queries.updateSubscription(userB, sub.id, "free", {
      amount: "19.99",
      priceHistorySource: "import_update",
    });
    expect(result).toEqual({ kind: "not_found" });

    const stillOwnedByA = await queries.getSubscription(userA, sub.id);
    expect(stillOwnedByA?.amountCents).toBe(1599);
    const history = await queries.getPriceHistory(userA, sub.id);
    expect(history).toHaveLength(1); // only the "initial" row — no unauthorized second row
  });
});
