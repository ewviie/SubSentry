import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for the realized-savings ledger (schema.ts's
// `realizedSavings`, written from queries.ts's updateSubscription) — the
// permanent "money SubSentry actually helped you save" record, distinct
// from savings.ts's computeSavingsRecommendations (a live, still-active-
// subscription "potential" detection this table never touches or is
// touched by). Same real-DB pattern as queries.reactivation.test.ts/
// queries.idor.test.ts. Skips cleanly wherever DATABASE_URL isn't set.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("updateSubscription: realized-savings ledger", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("./queries");
  let userA: string;
  let userB: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("./queries");

    const [a, b] = await db
      .insert(schema.users)
      .values([
        { email: `realized-savings-a-${Date.now()}@example.com`, passwordHash: "test-hash-not-real" },
        { email: `realized-savings-b-${Date.now()}@example.com`, passwordHash: "test-hash-not-real" },
      ])
      .returning();
    userA = a.id;
    userB = b.id;
    createdUserIds.push(userA, userB);
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    // Cascades to each user's own subscriptions and realized_savings rows
    // (both FKs are onDelete "cascade" on userId — see schema.ts).
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  function subInput(overrides: Partial<import("./validation").SubscriptionInput> = {}) {
    return {
      name: "Hulu",
      amount: "7.99",
      currency: "usd" as const,
      billingCycle: "monthly" as const,
      category: "other" as const,
      nextRenewalDate: "2099-01-01",
      status: "active" as const,
      ...overrides,
    };
  }

  async function realizedRowsFor(subscriptionId: string) {
    return db.select().from(schema.realizedSavings).where(eq(schema.realizedSavings.subscriptionId, subscriptionId));
  }

  it("1. creates exactly one realized-savings record on a genuine active->canceled cancellation", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Hulu — single record" }));

    const result = await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });
    expect(result.kind).toBe("updated");

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: userA,
      subscriptionId: sub.id,
      subscriptionName: "Hulu — single record",
      amountCents: 799,
      billingCycle: "monthly",
      currency: "usd",
      subscriptionSource: "manual",
    });
    expect(rows[0].canceledAt).toBeInstanceOf(Date);
  });

  it("2. a repeated cancellation PATCH (retry, double-submit) does not duplicate the record", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Hulu — repeat cancel" }));

    const first = await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });
    const second = await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });
    const third = await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });
    expect(first.kind).toBe("updated");
    expect(second.kind).toBe("updated");
    expect(third.kind).toBe("updated");

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(1);
  });

  it("2b. concurrent, racing cancel requests for the same subscription still produce exactly one record", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Hulu — racing cancel" }));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => queries.updateSubscription(userA, sub.id, "free", { status: "canceled" })),
    );
    expect(results.every((r) => r.kind === "updated")).toBe(true);

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(1);
  });

  it("3. annualizes correctly for monthly, quarterly, and yearly billing cycles", async () => {
    const monthly = await queries.createSubscription(userA, subInput({ name: "Monthly", amount: "10.00", billingCycle: "monthly" }));
    const quarterly = await queries.createSubscription(userA, subInput({ name: "Quarterly", amount: "30.00", billingCycle: "quarterly" }));
    // $99.99/yr, the exact-annual regression case money.ts's annualCents
    // exists for (not $99.99 * 12, and not a double-rounded monthly*12).
    const yearly = await queries.createSubscription(userA, subInput({ name: "Yearly", amount: "99.99", billingCycle: "yearly" }));

    await queries.updateSubscription(userA, monthly.id, "free", { status: "canceled" });
    await queries.updateSubscription(userA, quarterly.id, "free", { status: "canceled" });
    await queries.updateSubscription(userA, yearly.id, "free", { status: "canceled" });

    const records = await queries.getRealizedSavings(userA);
    const byName = new Map(records.map((r) => [r.subscriptionName, r]));

    const { annualCents } = await import("./money");
    expect(annualCents(byName.get("Monthly")!.amountCents, byName.get("Monthly")!.billingCycle)).toBe(12000);
    expect(annualCents(byName.get("Quarterly")!.amountCents, byName.get("Quarterly")!.billingCycle)).toBe(12000);
    expect(annualCents(byName.get("Yearly")!.amountCents, byName.get("Yearly")!.billingCycle)).toBe(9999);
  });

  it("4. preserves the subscription's own currency on the record, not the caller's default", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Spotify EUR", amount: "9.99", currency: "eur" }));
    await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });

    const rows = await realizedRowsFor(sub.id);
    expect(rows[0].currency).toBe("eur");
  });

  it("5. ownership isolation — user B cannot cancel or read user A's subscription/records", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Owned by A" }));

    const crossUserResult = await queries.updateSubscription(userB, sub.id, "free", { status: "canceled" });
    expect(crossUserResult.kind).toBe("not_found");

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(0);

    // A genuine cancellation by the real owner never leaks into another
    // user's own realized-savings list.
    await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });
    const bRecords = await queries.getRealizedSavings(userB);
    expect(bRecords.some((r) => r.subscriptionId === sub.id)).toBe(false);
    const aRecords = await queries.getRealizedSavings(userA);
    expect(aRecords.some((r) => r.subscriptionId === sub.id)).toBe(true);
  });

  it("6. deleting or mutating the subscription afterward cannot alter the historical record", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Original Name", amount: "12.34", currency: "usd" }));
    await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });

    const deleted = await queries.deleteSubscription(userA, sub.id);
    expect(deleted).toBe(true);

    const records = await queries.getRealizedSavings(userA);
    const record = records.find((r) => r.subscriptionName === "Original Name");
    expect(record).toBeDefined();
    // subscriptionId is set null by the FK (onDelete: "set null") once the
    // subscription row is gone — the snapshot columns are untouched.
    expect(record!.subscriptionId).toBeNull();
    expect(record!.amountCents).toBe(1234);
    expect(record!.currency).toBe("usd");
  });

  it("7a. a pause (not a cancellation) never creates a realized-savings record", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Just paused" }));
    await queries.updateSubscription(userA, sub.id, "free", { status: "paused" });

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(0);
  });

  it("7b. a paused->canceled transition never fabricates a realized-savings record (it was already not costing anything)", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Paused then canceled", status: "active" }));
    await queries.updateSubscription(userA, sub.id, "free", { status: "paused" });
    await queries.updateSubscription(userA, sub.id, "free", { status: "canceled" });

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(0);
  });

  it("7c. a failed cancellation (unknown subscription id) creates no record", async () => {
    const result = await queries.updateSubscription(userA, "00000000-0000-0000-0000-000000000000", "free", { status: "canceled" });
    expect(result.kind).toBe("not_found");
  });

  it("7d. an edit that isn't a cancellation (rename) creates no record", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Renamed" }));
    await queries.updateSubscription(userA, sub.id, "free", { name: "Renamed Again" });

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(0);
  });

  it("9. records a genuine cancellation identically for a free-plan and a pro-plan user (never gated by plan)", async () => {
    const freeSub = await queries.createSubscription(userA, subInput({ name: "Free plan cancel" }));
    const proSub = await queries.createSubscription(userA, subInput({ name: "Pro plan cancel" }));

    await queries.updateSubscription(userA, freeSub.id, "free", { status: "canceled" });
    await queries.updateSubscription(userA, proSub.id, "pro", { status: "canceled" });

    const freeRows = await realizedRowsFor(freeSub.id);
    const proRows = await realizedRowsFor(proSub.id);
    expect(freeRows).toHaveLength(1);
    expect(proRows).toHaveLength(1);
  });

  it("a cancellation combined with a price change in the same PATCH snapshots the new (post-edit) amount", async () => {
    const sub = await queries.createSubscription(userA, subInput({ name: "Cancel + reprice", amount: "10.00" }));
    await queries.updateSubscription(userA, sub.id, "free", { amount: "25.00", status: "canceled" });

    const rows = await realizedRowsFor(sub.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(2500);
  });
});
