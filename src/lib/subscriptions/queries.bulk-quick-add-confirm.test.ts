import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for bulk quick-add's confirm step (User Value
// Journey Audit, opportunity #1) — api/subscriptions/quick-add/bulk/confirm's
// own call: createSubscriptionsBulkWithLimitCheck(userId, plan, rows,
// "ai_parsed"). The plan-limit/ceiling/atomicity guarantees of that
// function itself are already thoroughly covered generically in
// queries.plan-limit.test.ts and queries.concurrency.test.ts — source is a
// plain passthrough tag with no special-casing inside that function (see
// queries.ts's subscriptionInsertValues), so re-deriving that whole matrix
// here with "ai_parsed" swapped in would just be the same coverage twice.
// What's actually new and worth a direct assertion here: rows created
// through THIS call site are really tagged "ai_parsed" (a wrong hardcoded
// literal would be a real, silent bug — nothing else here would catch it),
// arbitrary user edits made on the review screen before confirm really
// reach the DB verbatim, and this call site's own ownership/atomicity
// behavior holds too, not just assumed by extension.
const hasDb = Boolean(process.env.DATABASE_URL);

const { resolveHasReachedSubscriptionLimitMock } = vi.hoisted(() => ({
  resolveHasReachedSubscriptionLimitMock: vi.fn(),
}));

vi.mock("@/lib/dev/plan-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dev/plan-preview")>();
  return { ...actual, resolveHasReachedSubscriptionLimit: resolveHasReachedSubscriptionLimitMock };
});

describe.skipIf(!hasDb)("bulk quick-add confirm (createSubscriptionsBulkWithLimitCheck, source: ai_parsed)", () => {
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
        { email: `bulk-quick-add-a-${Date.now()}@example.com`, passwordHash: "test-hash-not-real" },
        { email: `bulk-quick-add-b-${Date.now()}@example.com`, passwordHash: "test-hash-not-real" },
      ])
      .returning();
    userA = a.id;
    userB = b.id;
    createdUserIds.push(userA, userB);
  });

  beforeEach(() => {
    resolveHasReachedSubscriptionLimitMock.mockReset();
    resolveHasReachedSubscriptionLimitMock.mockResolvedValue(false);
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  function row(overrides: Partial<import("./validation").SubscriptionInput> = {}) {
    return {
      name: "Netflix",
      amount: "15.99",
      currency: "usd" as const,
      billingCycle: "monthly" as const,
      category: "streaming" as const,
      nextRenewalDate: "2099-01-01",
      status: "active" as const,
      ...overrides,
    };
  }

  it("1. creates every row, tagged with the real ai_parsed provenance", async () => {
    const result = await queries.createSubscriptionsBulkWithLimitCheck(
      userA,
      "free",
      [row({ name: "Netflix" }), row({ name: "Spotify", amount: "9.99" })],
      "ai_parsed",
    );
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.subscriptions).toHaveLength(2);
    expect(result.subscriptions.every((s) => s.source === "ai_parsed")).toBe(true);
  });

  it("edits/removals: a row the user edited on the review screen (different name/amount/currency/billingCycle than any real parse would produce) is saved exactly as confirmed, not re-derived", async () => {
    const result = await queries.createSubscriptionsBulkWithLimitCheck(
      userA,
      "free",
      [row({ name: "Renamed by user", amount: "42.42", currency: "eur", billingCycle: "yearly" })],
      "ai_parsed",
    );
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.subscriptions[0]).toMatchObject({ name: "Renamed by user", amountCents: 4242, currency: "eur", billingCycle: "yearly" });
  });

  it("a row removed on the review screen before confirm was simply never sent — confirming the remainder creates only what's left", async () => {
    // Simulates the user having removed one of three parsed rows client-side
    // (BulkQuickAddReviewTable's removeRow) before this request was ever
    // sent — the confirm payload only ever contains what's left.
    const result = await queries.createSubscriptionsBulkWithLimitCheck(
      userA,
      "free",
      [row({ name: "Kept One" }), row({ name: "Kept Two" })],
      "ai_parsed",
    );
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.subscriptions.map((s) => s.name).sort()).toEqual(["Kept One", "Kept Two"]);
  });

  it("5. ownership: rows created for user A never appear under user B", async () => {
    await queries.createSubscriptionsBulkWithLimitCheck(userA, "free", [row({ name: "User A's Netflix" })], "ai_parsed");

    const bRows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userB));
    expect(bRows.some((s) => s.name === "User A's Netflix")).toBe(false);
    const aRows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userA));
    expect(aRows.some((s) => s.name === "User A's Netflix")).toBe(true);
  });

  it("3 & 6. limit enforcement blocks the whole batch and creates nothing (atomicity) when the free-plan check reports reached", async () => {
    resolveHasReachedSubscriptionLimitMock.mockResolvedValue(true);

    const before = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userA));

    const result = await queries.createSubscriptionsBulkWithLimitCheck(
      userA,
      "free",
      [row({ name: "Should not exist 1" }), row({ name: "Should not exist 2" })],
      "ai_parsed",
    );
    expect(result.kind).toBe("plan");

    const after = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userA));
    expect(after).toHaveLength(before.length);
    expect(after.some((s) => s.name.startsWith("Should not exist"))).toBe(false);
  });
});
