import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { inArray } from "drizzle-orm";

// DB-integration coverage for the free-plan-limit check on the create and
// bulk-import paths (createSubscriptionWithLimitCheck /
// createSubscriptionsBulkWithLimitCheck) — the two call sites
// queries.reactivation.test.ts's own identical comment doesn't cover (that
// file only exercises the reactivation branch inside updateSubscription).
// The real check is unconditionally false during the beta (BETA_ALL_ACCESS
// in lib/billing/plan.ts), so there is no way to observe a free-plan block
// through the real function right now. Mocked here, same
// vi.hoisted()/vi.mock() pattern as queries.reactivation.test.ts, so these
// tests exercise the actual DB wiring (does it call the check with the
// right count, does it honor "blocked", does a blocked call really insert
// nothing) independently of whether the beta flag happens to be on.
// queries.ts calls resolveHasReachedSubscriptionLimit
// (lib/dev/plan-preview.ts) rather than the real function directly — see
// that file's own comment on why — so that's the export mocked here.
// MAX_ACTIVE_SUBSCRIPTIONS and every other export from lib/billing/plan
// stay real.
const hasDb = Boolean(process.env.DATABASE_URL);

const { resolveHasReachedSubscriptionLimitMock } = vi.hoisted(() => ({
  resolveHasReachedSubscriptionLimitMock: vi.fn(),
}));

vi.mock("@/lib/dev/plan-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dev/plan-preview")>();
  return { ...actual, resolveHasReachedSubscriptionLimit: resolveHasReachedSubscriptionLimitMock };
});

describe.skipIf(!hasDb)("createSubscriptionWithLimitCheck / createSubscriptionsBulkWithLimitCheck — plan limit", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("./queries");
  let userA: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("./queries");
  });

  beforeEach(async () => {
    resolveHasReachedSubscriptionLimitMock.mockReset();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `plan-limit-${Date.now()}-${Math.random()}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    userA = user.id;
    createdUserIds.push(userA);
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  function subInput(name: string) {
    return {
      name,
      amount: "9.99",
      currency: "usd" as const,
      billingCycle: "monthly" as const,
      category: "other" as const,
      nextRenewalDate: "2099-01-01",
      status: "active" as const,
    };
  }

  describe("single create", () => {
    it("blocks a free user the limit check reports as 'reached', and creates nothing", async () => {
      resolveHasReachedSubscriptionLimitMock.mockReturnValue(true);
      const result = await queries.createSubscriptionWithLimitCheck(userA, "free", subInput("Sixth Sub"));

      expect(result).toEqual({ kind: "plan" });
      const rows = await queries.listSubscriptions(userA);
      expect(rows).toHaveLength(0);
    });

    it("allows a free user the limit check reports as 'not reached'", async () => {
      resolveHasReachedSubscriptionLimitMock.mockReturnValue(false);
      const result = await queries.createSubscriptionWithLimitCheck(userA, "free", subInput("Within Limit"));

      expect(result.kind).toBe("created");
      const rows = await queries.listSubscriptions(userA);
      expect(rows).toHaveLength(1);
    });

    it("passes the caller's actual plan through to the limit check, not a hardcoded 'free'", async () => {
      // Mirrors the real free/pro distinction (mocked only because
      // BETA_ALL_ACCESS makes the real function always report "not
      // reached" in this process — see this file's own top comment), not
      // an unconditional "always allow": if createSubscriptionWithLimitCheck
      // silently hardcoded "free" anywhere on this path instead of
      // forwarding the plan argument it was given, this call would be
      // blocked despite passing "pro".
      resolveHasReachedSubscriptionLimitMock.mockImplementation((plan: string) => plan !== "pro");
      const result = await queries.createSubscriptionWithLimitCheck(userA, "pro", subInput("Pro Unlimited"));

      expect(result.kind).toBe("created");
    });
  });

  describe("bulk import", () => {
    it("blocks the whole batch for a free user the limit check reports as 'reached', and creates nothing", async () => {
      resolveHasReachedSubscriptionLimitMock.mockReturnValue(true);
      const result = await queries.createSubscriptionsBulkWithLimitCheck(
        userA,
        "free",
        [subInput("Import 1"), subInput("Import 2")],
        "csv_import",
      );

      expect(result).toEqual({ kind: "plan" });
      const rows = await queries.listSubscriptions(userA);
      expect(rows).toHaveLength(0);
    });

    it("creates every row in the batch for a free user the limit check reports as 'not reached'", async () => {
      resolveHasReachedSubscriptionLimitMock.mockReturnValue(false);
      const result = await queries.createSubscriptionsBulkWithLimitCheck(
        userA,
        "free",
        [subInput("Import 1"), subInput("Import 2"), subInput("Import 3")],
        "csv_import",
      );

      expect(result.kind).toBe("created");
      const rows = await queries.listSubscriptions(userA);
      expect(rows).toHaveLength(3);
    });

    it("passes the caller's actual plan through to the limit check on the bulk path too", async () => {
      resolveHasReachedSubscriptionLimitMock.mockImplementation((plan: string) => plan !== "pro");
      const result = await queries.createSubscriptionsBulkWithLimitCheck(
        userA,
        "pro",
        [subInput("Import 1"), subInput("Import 2")],
        "csv_import",
      );

      expect(result.kind).toBe("created");
      const rows = await queries.listSubscriptions(userA);
      expect(rows).toHaveLength(2);
    });
  });
});
