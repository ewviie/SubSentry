import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { inArray } from "drizzle-orm";

// DB-integration coverage for the free-plan-limit re-check on subscription
// reactivation (updateSubscription's `mayActivate` branch). Same real-DB
// pattern as queries.idor.test.ts/queries.price-history.test.ts. Skips
// cleanly wherever DATABASE_URL isn't set.
const hasDb = Boolean(process.env.DATABASE_URL);

// hasReachedSubscriptionLimit is unconditionally false during the beta
// (BETA_ALL_ACCESS in lib/billing/plan.ts — see that file's own comment),
// so there is no way to observe this code path's behavior end-to-end
// through the real function right now. Mocked here, the same way
// renewal-reminders.db.test.ts mocks nodemailer, so this test exercises the
// actual wiring in updateSubscription (does it call the check, at the right
// moment, with the right count, and honor the result) independently of
// whether the beta flag happens to be on. MAX_ACTIVE_SUBSCRIPTIONS and every
// other export stay real.
const { hasReachedSubscriptionLimitMock } = vi.hoisted(() => ({
  hasReachedSubscriptionLimitMock: vi.fn(),
}));

vi.mock("@/lib/billing/plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/plan")>();
  return { ...actual, hasReachedSubscriptionLimit: hasReachedSubscriptionLimitMock };
});

describe.skipIf(!hasDb)("updateSubscription: reactivation re-checks the free-plan limit", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("./queries");
  let userA: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("./queries");

    const [a] = await db
      .insert(schema.users)
      .values({ email: `reactivation-${Date.now()}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userA = a.id;
    createdUserIds.push(userA);
  });

  beforeEach(() => {
    hasReachedSubscriptionLimitMock.mockReset();
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  function subInput(name: string, status: "active" | "canceled") {
    return {
      name,
      amount: "9.99",
      currency: "usd" as const,
      billingCycle: "monthly" as const,
      category: "other" as const,
      nextRenewalDate: "2099-01-01",
      status,
    };
  }

  it("blocks reactivating a cancelled subscription once the plan-limit check reports 'reached', and leaves the row untouched", async () => {
    hasReachedSubscriptionLimitMock.mockReturnValue(true);
    const sub = await queries.createSubscription(userA, subInput("Blocked Reactivation", "canceled"));

    const result = await queries.updateSubscription(userA, sub.id, "free", { status: "active" });

    expect(result).toEqual({ kind: "plan" });
    const stillCancelled = await queries.getSubscription(userA, sub.id);
    expect(stillCancelled?.status).toBe("canceled");
  });

  it("allows reactivating once the plan-limit check reports 'not reached'", async () => {
    hasReachedSubscriptionLimitMock.mockReturnValue(false);
    const sub = await queries.createSubscription(userA, subInput("Allowed Reactivation", "canceled"));

    const result = await queries.updateSubscription(userA, sub.id, "free", { status: "active" });

    expect(result.kind).toBe("updated");
    if (result.kind === "updated") expect(result.subscription.status).toBe("active");
  });

  it("does not re-check the limit for a subscription that is already active (no-op transition)", async () => {
    hasReachedSubscriptionLimitMock.mockReturnValue(true);
    const sub = await queries.createSubscription(userA, subInput("Already Active", "active"));

    const result = await queries.updateSubscription(userA, sub.id, "free", { status: "active" });

    expect(result.kind).toBe("updated");
    expect(hasReachedSubscriptionLimitMock).not.toHaveBeenCalled();
  });

  it("does not check the limit when the update doesn't touch status at all", async () => {
    hasReachedSubscriptionLimitMock.mockReturnValue(true);
    const sub = await queries.createSubscription(userA, subInput("Rename Only", "canceled"));

    const result = await queries.updateSubscription(userA, sub.id, "free", { name: "Renamed" });

    expect(result.kind).toBe("updated");
    expect(hasReachedSubscriptionLimitMock).not.toHaveBeenCalled();
  });
});
