import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { DetectedSubscription } from "./types";

// DB-integration coverage for the Watchdog phase's central job: per-account
// failure isolation, idempotent price-change auto-apply, and that a
// dead/broken connection never aborts the rest of the run. The
// provider-specific fetch layer (sync-transactions.ts) is mocked here —
// its own faithfulness to the pre-existing interactive routes is a
// same-diff extraction, not new logic to re-verify; what this file proves
// is connected-account-sync-job.ts's own orchestration (which this repo
// has no other way to verify against a mock, same rationale every other
// .db.test.ts in this repo documents on itself). Skips cleanly wherever
// DATABASE_URL isn't set.
const hasDb = Boolean(process.env.DATABASE_URL);

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn((_options: unknown) => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});
vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransportMock(options) },
}));

const { syncPlaidMock, syncTrueLayerMock, syncGmailMock } = vi.hoisted(() => ({
  syncPlaidMock: vi.fn(),
  syncTrueLayerMock: vi.fn(),
  syncGmailMock: vi.fn(),
}));
vi.mock("./sync-transactions", () => ({
  syncPlaidTransactions: syncPlaidMock,
  syncTrueLayerTransactions: syncTrueLayerMock,
  syncGmailTransactions: syncGmailMock,
}));

// Monetization gate coverage: hasPaidAccess is mocked (not the real
// BETA_ALL_ACCESS constant, which this suite must never touch — see
// plan.ts's own comment on why it's a hardcoded, not env-driven, flag)
// specifically so tests can exercise the "after beta" free-vs-pro branch
// this file's own job now has, alongside the real, current beta-on
// behavior (plan.test.ts already covers hasPaidAccess's own beta logic in
// isolation; this only proves the sync job correctly *consults* it).
// Defaults to `true` in beforeEach — the same effectively-always-true
// state hasPaidAccess(plan) actually returns today — so every
// pre-existing test in this file that predates the gate keeps passing
// unchanged; only the tests in the "Pro-only automatic sync" describe
// block below override it.
const { hasPaidAccessMock } = vi.hoisted(() => ({ hasPaidAccessMock: vi.fn() }));
vi.mock("@/lib/billing/plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/plan")>();
  return { ...actual, hasPaidAccess: hasPaidAccessMock };
});

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
let savedEnv: Record<string, string | undefined>;

function detectedSub(overrides: Partial<DetectedSubscription> = {}): DetectedSubscription {
  return {
    id: crypto.randomUUID(),
    merchant: { displayName: "Test Merchant", category: "other", isKnownSubscriptionMerchant: false },
    transactions: [{ date: "2026-08-01", description: "TEST MERCHANT", amountCents: 1500, direction: "debit", currency: "usd" }],
    amountCents: 1500,
    amountVariancePct: 0,
    estimatedBillingCycle: { cycle: "monthly", averageIntervalDays: 30, intervalVarianceDays: 0 },
    monthsSeen: 2,
    confidence: "high",
    confidenceSignals: ["known_subscription_merchant"],
    suggestedNextRenewalDate: "2026-09-01",
    ...overrides,
  };
}

describe.skipIf(!hasDb)("connected-account sync job (DB integration)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let syncJob: typeof import("./connected-account-sync-job");
  let queries: typeof import("@/lib/subscriptions/queries");
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    syncJob = await import("./connected-account-sync-job");
    queries = await import("@/lib/subscriptions/queries");
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.SMTP_HOST = "smtp-mail.outlook.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@outlook.com";
    process.env.SMTP_PASSWORD = "pw";
    process.env.SMTP_FROM = "SubSentry <user@outlook.com>";
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: "msg-1", accepted: ["x@example.com"], rejected: [] });
    syncPlaidMock.mockReset();
    syncTrueLayerMock.mockReset();
    syncGmailMock.mockReset();
    syncTrueLayerMock.mockResolvedValue({ ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } });
    syncGmailMock.mockResolvedValue({ ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } });
    hasPaidAccessMock.mockReset();
    hasPaidAccessMock.mockReturnValue(true); // the real, current beta-on state — see this mock's own header comment
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (createdUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
      createdUserIds.length = 0;
    }
  });

  async function makeUser(plan: "free" | "pro" = "free") {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [row] = await db
      .insert(schema.users)
      .values({ email: `sync-job-test-${stamp}@example.com`, passwordHash: "test-hash-not-real", emailVerified: true, plan })
      .returning();
    createdUserIds.push(row.id);
    return row.id;
  }

  async function makeBankConnection(userId: string, provider: "plaid" | "truelayer" = "plaid") {
    const [row] = await db
      .insert(schema.bankConnections)
      .values({ userId, provider, providerItemId: `item-${Math.random()}`, institutionName: "Test Bank", accessTokenEncrypted: "irrelevant-mocked" })
      .returning();
    return row;
  }

  it("auto-applies a high-confidence price increase to an existing subscription, via the same updateSubscription path a manual edit uses", async () => {
    const userId = await makeUser();
    await makeBankConnection(userId);
    const sub = await queries.createSubscription(userId, {
      name: "Netflix",
      amount: "20.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    syncPlaidMock.mockResolvedValue({
      ok: true,
      result: {
        detected: [detectedSub({ isDuplicateOfExistingId: sub.id, confidence: "high", priceChangeProposal: {
          existingSubscriptionId: sub.id,
          existingName: "Netflix",
          existingAmountCents: 2000,
          existingBillingCycle: "monthly",
          currency: "usd",
          detectedAmountCents: 2500,
          detectedBillingCycle: "monthly",
          percentChange: 25,
          annualDeltaCents: 6000,
        } })],
        warnings: [],
        skippedRowCount: 0,
      },
    });

    const result = await syncJob.runConnectedAccountSyncJob();
    expect(result.priceIncreasesApplied).toBe(1);
    expect(result.accountsProcessed).toBe(1);

    const history = await queries.getPriceHistory(userId, sub.id);
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ amountCents: 2500, source: "import_update" });
    expect(sendMailMock).toHaveBeenCalled(); // price-increase email sent
  });

  it("running the same sync twice is idempotent — no duplicate price-history row the second time", async () => {
    const userId = await makeUser();
    await makeBankConnection(userId);
    const sub = await queries.createSubscription(userId, {
      name: "Spotify",
      amount: "10.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const proposal = {
      existingSubscriptionId: sub.id,
      existingName: "Spotify",
      existingAmountCents: 1000,
      existingBillingCycle: "monthly" as const,
      currency: "usd",
      detectedAmountCents: 1200,
      detectedBillingCycle: "monthly" as const,
      percentChange: 20,
      annualDeltaCents: 2400,
    };
    syncPlaidMock.mockResolvedValue({
      ok: true,
      result: { detected: [detectedSub({ isDuplicateOfExistingId: sub.id, confidence: "high", priceChangeProposal: proposal })], warnings: [], skippedRowCount: 0 },
    });

    await syncJob.runConnectedAccountSyncJob();
    const afterFirst = await queries.getPriceHistory(userId, sub.id);
    expect(afterFirst).toHaveLength(2);

    const secondResult = await syncJob.runConnectedAccountSyncJob();
    const afterSecond = await queries.getPriceHistory(userId, sub.id);
    expect(afterSecond).toHaveLength(2); // no new row — the price didn't change further
    expect(secondResult.priceIncreasesApplied).toBe(0); // updateSubscription wrote no new price-history row -> no genuine increase reported
  });

  it("one connection's provider failure never aborts the rest of the run", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await makeBankConnection(userA, "plaid");
    const connB = await makeBankConnection(userB, "truelayer");
    const subB = await queries.createSubscription(userB, {
      name: "Adobe",
      amount: "50.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "software",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    // userA's Plaid connection fails outright.
    syncPlaidMock.mockResolvedValue({ ok: false, reason: "provider_error" });
    // userB's TrueLayer connection succeeds with a real high-confidence increase.
    syncTrueLayerMock.mockImplementation(async (connection: { id: string }) => {
      if (connection.id !== connB.id) return { ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } };
      return {
        ok: true,
        result: {
          detected: [
            detectedSub({
              isDuplicateOfExistingId: subB.id,
              confidence: "high",
              priceChangeProposal: {
                existingSubscriptionId: subB.id,
                existingName: "Adobe",
                existingAmountCents: 5000,
                existingBillingCycle: "monthly",
                currency: "usd",
                detectedAmountCents: 5500,
                detectedBillingCycle: "monthly",
                percentChange: 10,
                annualDeltaCents: 6000,
              },
            }),
          ],
          warnings: [],
          skippedRowCount: 0,
        },
      };
    });

    const result = await syncJob.runConnectedAccountSyncJob();
    expect(result.accountsSkipped).toBeGreaterThanOrEqual(1); // userA's broken account
    expect(result.priceIncreasesApplied).toBeGreaterThanOrEqual(1); // userB's still went through

    const historyB = await queries.getPriceHistory(userB, subB.id);
    expect(historyB).toHaveLength(2);
  });

  it("never auto-applies a medium-confidence proposal — stricter than the interactive Import Center's own bar", async () => {
    const userId = await makeUser();
    await makeBankConnection(userId);
    const sub = await queries.createSubscription(userId, {
      name: "Dropbox",
      amount: "10.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "software",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    syncPlaidMock.mockResolvedValue({
      ok: true,
      result: {
        detected: [
          detectedSub({
            isDuplicateOfExistingId: sub.id,
            confidence: "medium",
            priceChangeProposal: {
              existingSubscriptionId: sub.id,
              existingName: "Dropbox",
              existingAmountCents: 1000,
              existingBillingCycle: "monthly",
              currency: "usd",
              detectedAmountCents: 1200,
              detectedBillingCycle: "monthly",
              percentChange: 20,
              annualDeltaCents: 2400,
            },
          }),
        ],
        warnings: [],
        skippedRowCount: 0,
      },
    });

    const result = await syncJob.runConnectedAccountSyncJob();
    expect(result.priceIncreasesApplied).toBe(0);
    const history = await queries.getPriceHistory(userId, sub.id);
    expect(history).toHaveLength(1); // still just the "initial" row

    // Council-review fix: the medium-confidence proposal is preserved as a
    // reviewable notification instead of being silently discarded — this
    // is the actual regression this fix targets, not just "nothing was
    // auto-applied" (which was already true before the fix too).
    expect(result.priceChangesForReview).toBe(1);
    const [notification] = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(notification).toMatchObject({ type: "price_change_review", subscriptionId: sub.id, severity: "info" });
  });

  it("a medium-confidence proposal detected twice (two daily syncs) produces exactly one review notification", async () => {
    const userId = await makeUser();
    await makeBankConnection(userId);
    const sub = await queries.createSubscription(userId, {
      name: "Dropbox",
      amount: "10.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "software",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    const proposal = {
      existingSubscriptionId: sub.id,
      existingName: "Dropbox",
      existingAmountCents: 1000,
      existingBillingCycle: "monthly" as const,
      currency: "usd",
      detectedAmountCents: 1200,
      detectedBillingCycle: "monthly" as const,
      percentChange: 20,
      annualDeltaCents: 2400,
    };
    syncPlaidMock.mockResolvedValue({
      ok: true,
      result: { detected: [detectedSub({ isDuplicateOfExistingId: sub.id, confidence: "medium", priceChangeProposal: proposal })], warnings: [], skippedRowCount: 0 },
    });

    await syncJob.runConnectedAccountSyncJob();
    const secondResult = await syncJob.runConnectedAccountSyncJob();

    expect(secondResult.priceChangesForReview).toBe(1); // still "flagged" this run (see the counter's own comment) —
    const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(notifications.filter((n) => n.type === "price_change_review")).toHaveLength(1); // but genuinely idempotent: only one row ever exists
  });

  it("a genuine subsequent price change (a different detected amount) produces a second, distinct review notification", async () => {
    const userId = await makeUser();
    await makeBankConnection(userId);
    const sub = await queries.createSubscription(userId, {
      name: "Dropbox",
      amount: "10.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "software",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    const baseProposal = {
      existingSubscriptionId: sub.id,
      existingName: "Dropbox",
      existingAmountCents: 1000,
      existingBillingCycle: "monthly" as const,
      currency: "usd",
      detectedBillingCycle: "monthly" as const,
      percentChange: 20,
      annualDeltaCents: 2400,
    };

    syncPlaidMock.mockResolvedValueOnce({
      ok: true,
      result: { detected: [detectedSub({ isDuplicateOfExistingId: sub.id, confidence: "medium", priceChangeProposal: { ...baseProposal, detectedAmountCents: 1200 } })], warnings: [], skippedRowCount: 0 },
    });
    await syncJob.runConnectedAccountSyncJob();

    syncPlaidMock.mockResolvedValueOnce({
      ok: true,
      result: { detected: [detectedSub({ isDuplicateOfExistingId: sub.id, confidence: "medium", priceChangeProposal: { ...baseProposal, detectedAmountCents: 1500 } })], warnings: [], skippedRowCount: 0 },
    });
    await syncJob.runConnectedAccountSyncJob();

    const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(notifications.filter((n) => n.type === "price_change_review")).toHaveLength(2); // genuinely new evidence, not permanently suppressed
  });

  it("flags an unusual charge for an existing subscription with irregular amounts, without applying anything", async () => {
    const userId = await makeUser();
    await makeBankConnection(userId);
    const sub = await queries.createSubscription(userId, {
      name: "Gym Membership",
      amount: "30.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "fitness",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    syncPlaidMock.mockResolvedValue({
      ok: true,
      result: {
        detected: [
          detectedSub({
            isDuplicateOfExistingId: sub.id,
            confidence: "low",
            amountVariancePct: 0.4, // well over the 0.15 unusual-charge bar
            priceChangeProposal: undefined,
          }),
        ],
        warnings: [],
        skippedRowCount: 0,
      },
    });

    const result = await syncJob.runConnectedAccountSyncJob();
    expect(result.unusualChargesFlagged).toBe(1);

    const [notification] = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(notification).toMatchObject({ type: "unusual_charge", subscriptionId: sub.id });
  });

  describe("connection_issue notifications (council-review fix, silent-failure path #1)", () => {
    it("a reconnect_required failure surfaces as a real, actionable notification", async () => {
      const userId = await makeUser();
      const conn = await makeBankConnection(userId, "truelayer");
      syncTrueLayerMock.mockResolvedValue({ ok: false, reason: "reconnect_required" });

      const result = await syncJob.runConnectedAccountSyncJob();
      expect(result.connectionIssuesFlagged).toBeGreaterThanOrEqual(1);
      expect(result.accountsSkipped).toBeGreaterThanOrEqual(1);

      const [notification] = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      expect(notification).toMatchObject({ type: "connection_issue", severity: "warning", actionHref: "/settings", subscriptionId: null });
      // dedupeKey scoped to this specific connection — see generate.ts's
      // own comment on why (a user could have more than one connection).
      expect(notification.dedupeKey).toContain(conn.id);
    });

    it("a decrypt_error failure is also surfaced — same user-facing remediation as reconnect_required", async () => {
      const userId = await makeUser();
      await makeBankConnection(userId, "plaid");
      syncPlaidMock.mockResolvedValue({ ok: false, reason: "decrypt_error" });

      const result = await syncJob.runConnectedAccountSyncJob();
      expect(result.connectionIssuesFlagged).toBeGreaterThanOrEqual(1);
      const [notification] = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      expect(notification.type).toBe("connection_issue");
    });

    it("a transient provider_error is deliberately NOT surfaced as a reconnect notification — nothing to reconnect, next run retries it automatically", async () => {
      const userId = await makeUser();
      await makeBankConnection(userId, "plaid");
      syncPlaidMock.mockResolvedValue({ ok: false, reason: "provider_error" });

      const result = await syncJob.runConnectedAccountSyncJob();
      expect(result.connectionIssuesFlagged).toBe(0);
      const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      expect(notifications).toHaveLength(0);
    });

    it("running the sync twice against the same broken connection produces exactly one notification (idempotent, no daily spam)", async () => {
      const userId = await makeUser();
      await makeBankConnection(userId, "plaid");
      syncPlaidMock.mockResolvedValue({ ok: false, reason: "reconnect_required" });

      await syncJob.runConnectedAccountSyncJob();
      await syncJob.runConnectedAccountSyncJob();

      const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
      expect(notifications.filter((n) => n.type === "connection_issue")).toHaveLength(1);
    });

    it("a broken connection's notification reaches only its own owning user, never another user's (IDOR/ownership)", async () => {
      const userA = await makeUser();
      const userB = await makeUser();
      await makeBankConnection(userA, "plaid");
      const connB = await makeBankConnection(userB, "truelayer");

      syncPlaidMock.mockResolvedValue({ ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } }); // userA's own sync is healthy
      syncTrueLayerMock.mockImplementation(async (connection: { id: string }) =>
        connection.id === connB.id ? { ok: false, reason: "reconnect_required" } : { ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } },
      );

      await syncJob.runConnectedAccountSyncJob();

      const notificationsA = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userA));
      const notificationsB = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userB));
      expect(notificationsA).toHaveLength(0); // userA's connection was healthy — nothing to flag
      expect(notificationsB.filter((n) => n.type === "connection_issue")).toHaveLength(1); // only userB, whose connection actually broke
    });
  });

  describe("automatic sync is Pro-only after beta (monetization gate)", () => {
    it("beta all-access: a free-plan user's connection still syncs normally — hasPaidAccess(plan) is true for every plan", async () => {
      // hasPaidAccessMock defaults to true in beforeEach — the real,
      // current BETA_ALL_ACCESS=true behavior — deliberately NOT
      // overridden in this test, so this proves the sync job doesn't add
      // any of its own free/pro special-casing on top of what
      // hasPaidAccess already decided.
      const userId = await makeUser("free");
      await makeBankConnection(userId, "plaid");
      const sub = await queries.createSubscription(userId, {
        name: "Netflix",
        amount: "20.00",
        currency: "usd",
        billingCycle: "monthly",
        category: "streaming",
        nextRenewalDate: "2099-01-01",
        status: "active",
      });
      syncPlaidMock.mockResolvedValue({
        ok: true,
        result: {
          detected: [
            detectedSub({
              isDuplicateOfExistingId: sub.id,
              confidence: "high",
              priceChangeProposal: {
                existingSubscriptionId: sub.id,
                existingName: "Netflix",
                existingAmountCents: 2000,
                existingBillingCycle: "monthly",
                currency: "usd",
                detectedAmountCents: 2500,
                detectedBillingCycle: "monthly",
                percentChange: 25,
                annualDeltaCents: 6000,
              },
            }),
          ],
          warnings: [],
          skippedRowCount: 0,
        },
      });

      const result = await syncJob.runConnectedAccountSyncJob();
      expect(result.accountsSkippedFreePlan).toBe(0);
      expect(result.priceIncreasesApplied).toBeGreaterThanOrEqual(1);
      const history = await queries.getPriceHistory(userId, sub.id);
      expect(history).toHaveLength(2); // the auto-apply genuinely went through
    });

    it("post-beta: a free-plan user's connection is skipped before any provider call, a pro user's still syncs", async () => {
      hasPaidAccessMock.mockImplementation((plan: string) => plan === "pro");

      const freeUserId = await makeUser("free");
      const proUserId = await makeUser("pro");
      await makeBankConnection(freeUserId, "plaid");
      const proConn = await makeBankConnection(proUserId, "truelayer");
      const proSub = await queries.createSubscription(proUserId, {
        name: "Adobe",
        amount: "50.00",
        currency: "usd",
        billingCycle: "monthly",
        category: "software",
        nextRenewalDate: "2099-01-01",
        status: "active",
      });

      // If the free user's connection is (incorrectly) reached, this
      // would produce a real, detectable side effect — proving the gate
      // fired BEFORE the provider was ever called, not just that no
      // notification happened to result.
      syncPlaidMock.mockRejectedValue(new Error("should never be called for a free-plan connection"));
      syncTrueLayerMock.mockImplementation(async (connection: { id: string }) =>
        connection.id === proConn.id
          ? {
              ok: true,
              result: {
                detected: [
                  detectedSub({
                    isDuplicateOfExistingId: proSub.id,
                    confidence: "high",
                    priceChangeProposal: {
                      existingSubscriptionId: proSub.id,
                      existingName: "Adobe",
                      existingAmountCents: 5000,
                      existingBillingCycle: "monthly",
                      currency: "usd",
                      detectedAmountCents: 5500,
                      detectedBillingCycle: "monthly",
                      percentChange: 10,
                      annualDeltaCents: 6000,
                    },
                  }),
                ],
                warnings: [],
                skippedRowCount: 0,
              },
            }
          : { ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } },
      );

      const result = await syncJob.runConnectedAccountSyncJob();
      expect(result.accountsSkippedFreePlan).toBeGreaterThanOrEqual(1);
      expect(syncPlaidMock).not.toHaveBeenCalled(); // the gate fired before the provider call, not after
      expect(result.priceIncreasesApplied).toBeGreaterThanOrEqual(1); // the pro user's own sync still went through

      const proHistory = await queries.getPriceHistory(proUserId, proSub.id);
      expect(proHistory).toHaveLength(2);
    });

    it("a gated-out free-plan connection still has lastSyncedAt bumped, so it doesn't permanently crowd the fair-rotation queue", async () => {
      hasPaidAccessMock.mockImplementation((plan: string) => plan === "pro");
      const userId = await makeUser("free");
      const conn = await makeBankConnection(userId, "plaid");

      await syncJob.runConnectedAccountSyncJob();

      const [refreshed] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, conn.id));
      expect(refreshed.lastSyncedAt).not.toBeNull();
    });

    it("ownership: a free user's data is never touched even when a same-run pro user's sync succeeds (IDOR/isolation)", async () => {
      hasPaidAccessMock.mockImplementation((plan: string) => plan === "pro");
      const freeUserId = await makeUser("free");
      const proUserId = await makeUser("pro");
      const freeSub = await queries.createSubscription(freeUserId, {
        name: "Netflix",
        amount: "20.00",
        currency: "usd",
        billingCycle: "monthly",
        category: "streaming",
        nextRenewalDate: "2099-01-01",
        status: "active",
      });
      await makeBankConnection(freeUserId, "plaid");
      const proConn = await makeBankConnection(proUserId, "truelayer");
      syncPlaidMock.mockResolvedValue({ ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } }); // unreachable in practice — gated before this
      syncTrueLayerMock.mockImplementation(async (connection: { id: string }) =>
        connection.id === proConn.id
          ? { ok: false, reason: "reconnect_required" }
          : { ok: true, result: { detected: [], warnings: [], skippedRowCount: 0 } },
      );

      await syncJob.runConnectedAccountSyncJob();

      // The pro user's broken connection produced its own notification —
      // it must never leak onto the free user's account.
      const freeNotifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, freeUserId));
      const proNotifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, proUserId));
      expect(freeNotifications).toHaveLength(0);
      expect(proNotifications.filter((n) => n.type === "connection_issue")).toHaveLength(1);

      // And the free user's own subscription/price-history is completely
      // untouched by a run that gated their connection out.
      const freeHistory = await queries.getPriceHistory(freeUserId, freeSub.id);
      expect(freeHistory).toHaveLength(1); // still just "initial"
    });
  });
});
