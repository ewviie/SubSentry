import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for the renewal-reminder job — candidate
// selection, the claim/reclaim idempotency mechanism, concurrent-execution
// safety, and cross-user isolation. Same real-Postgres-required pattern as
// queries.concurrency.test.ts/queries.idor.test.ts: none of this (two
// connections actually racing a conditional UPDATE, a partial index
// actually being used) is provable against a mock. Skips cleanly wherever
// DATABASE_URL isn't set.
const hasDb = Boolean(process.env.DATABASE_URL);

// Mocked exactly like lib/auth/email.test.ts — SMTP_* set so
// sendTransactionalEmail takes the real-transporter branch (not the
// demo-mode console.log branch, which always "succeeds" and would make the
// failure-handling test below impossible to exercise).
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn((_options: unknown) => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransportMock(options) },
}));

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "CRON_SECRET"] as const;
let savedEnv: Record<string, string | undefined>;

describe.skipIf(!hasDb)("renewal reminders (DB integration)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let reminders: typeof import("./renewal-reminders");
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    reminders = await import("./renewal-reminders");
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.SMTP_HOST = "smtp-mail.outlook.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@outlook.com";
    process.env.SMTP_PASSWORD = "pw";
    process.env.SMTP_FROM = "SubSentry <user@outlook.com>";
    process.env.CRON_SECRET = "test-cron-secret";
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: "msg-1", accepted: ["x@example.com"], rejected: [] });
  });

  // Per-test cleanup, not afterAll: findReminderCandidates() scans *across
  // every user*, by design (see its own comment) — so a subscription left
  // behind by one test (e.g. the candidate-selection tests below, which
  // deliberately never call runRenewalReminderJob) is a genuinely eligible
  // candidate the *next* test's own job run would also pick up. The strict
  // counting assertions later in this file (concurrent-run totalSent === 1,
  // sendMailMock call counts) are only correct if each test starts from an
  // empty table; cleaning up after every test (not once at the end) is what
  // actually guarantees that, rather than relying on incidental test order.
  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (createdUserIds.length > 0) {
      // users.id cascades to subscriptions cascades to renewal_reminders
      // (both onDelete: "cascade" — see schema.ts), so deleting the users is
      // sufficient cleanup.
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
      createdUserIds.length = 0;
    }
  });

  function isoDateOffset(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }

  async function createTestUser(overrides: Partial<{ emailVerified: boolean; renewalRemindersEnabled: boolean }> = {}) {
    const email = `renewal-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash: "test-hash-not-real",
        emailVerified: overrides.emailVerified ?? true,
        renewalRemindersEnabled: overrides.renewalRemindersEnabled ?? true,
      })
      .returning();
    createdUserIds.push(user.id);
    return user;
  }

  async function createTestSubscription(
    userId: string,
    overrides: Partial<{ nextRenewalDate: string; status: "active" | "paused" | "canceled"; name: string }> = {},
  ) {
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        userId,
        name: overrides.name ?? "Netflix",
        amountCents: 1599,
        currency: "usd",
        billingCycle: "monthly",
        category: "streaming",
        nextRenewalDate: overrides.nextRenewalDate ?? isoDateOffset(2),
        status: overrides.status ?? "active",
      })
      .returning();
    return subscription;
  }

  // ── Candidate selection ─────────────────────────────────────────────

  it("includes a subscription renewing inside the reminder window", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(true);
  });

  it("excludes a subscription renewing too far in the future", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(10) });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(false);
  });

  it("excludes a subscription whose renewal date has already passed", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(-1) });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(false);
  });

  it("excludes a canceled subscription", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2), status: "canceled" });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(false);
  });

  it("excludes a paused subscription", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2), status: "paused" });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(false);
  });

  it("excludes a subscription owned by a user with no verified email", async () => {
    const user = await createTestUser({ emailVerified: false });
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(false);
  });

  it("excludes a subscription owned by a user who opted out", async () => {
    const user = await createTestUser({ renewalRemindersEnabled: false });
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    const candidates = await reminders.findReminderCandidates();
    expect(candidates.some((c) => c.subscriptionId === subscription.id)).toBe(false);
  });

  // ── Renewal-time price reconfirmation ───────────────────────────────

  it("includes a real 'your last charge was' line when price history shows a genuine prior price", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });
    // subscription.amountCents is 1599 (createTestSubscription's own
    // fixed value) — two price-history rows, the latest matching that
    // current price, so computeLatestPriceChange finds a genuine increase.
    await db.insert(schema.subscriptionPriceHistory).values([
      { subscriptionId: subscription.id, userId: user.id, amountCents: 1299, billingCycle: "monthly", currency: "usd", observedAt: new Date("2026-01-01"), source: "initial" },
      { subscriptionId: subscription.id, userId: user.id, amountCents: 1599, billingCycle: "monthly", currency: "usd", observedAt: new Date("2026-06-01"), source: "user_edit" },
    ]);

    await reminders.runRenewalReminderJob();
    const call = sendMailMock.mock.calls.find(([msg]) => msg.to === user.email);
    expect(call).toBeDefined();
    expect(call![0].html).toContain("Your last charge was $12.99");
    expect(call![0].html).toContain("more");
    expect(call![0].text).toContain("Your last charge was $12.99");
  });

  it("omits the price-reconfirmation line entirely when there's no recorded price history", async () => {
    const user = await createTestUser();
    await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    await reminders.runRenewalReminderJob();
    const call = sendMailMock.mock.calls.find(([msg]) => msg.to === user.email);
    expect(call).toBeDefined();
    expect(call![0].html).not.toContain("Your last charge was");
    expect(call![0].text).not.toContain("Your last charge was");
  });

  // ── End-to-end send + idempotency ───────────────────────────────────

  it("sends exactly one email to the subscription's own owning user", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    const result = await reminders.runRenewalReminderJob();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sendMailMock).toHaveBeenCalled();
    const call = sendMailMock.mock.calls.find(([msg]) => msg.to === user.email);
    expect(call).toBeDefined();
    expect(call![0].subject).toContain(subscription.name);

    const [row] = await db
      .select()
      .from(schema.renewalReminders)
      .where(eq(schema.renewalReminders.subscriptionId, subscription.id));
    expect(row.sentAt).not.toBeNull();
  });

  it("running the job twice does not send a second email for the same renewal event", async () => {
    const user = await createTestUser();
    await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    const first = await reminders.runRenewalReminderJob();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const callsAfterFirst = sendMailMock.mock.calls.length;

    const second = await reminders.runRenewalReminderJob();
    expect(second.sent).toBe(0);
    expect(sendMailMock.mock.calls.length).toBe(callsAfterFirst); // no additional send
  });

  it("two concurrent job runs never both send for the same renewal event", async () => {
    const user = await createTestUser();
    await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    const [a, b] = await Promise.all([reminders.runRenewalReminderJob(), reminders.runRenewalReminderJob()]);
    const totalSent = a.sent + b.sent;
    expect(totalSent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("a changed renewal date is treated as a new event and gets its own reminder", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });

    await reminders.runRenewalReminderJob();
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    // Renewal date changes (user edited it, or it rolled forward) — same
    // subscription id, different date.
    const newDate = isoDateOffset(3);
    await db.update(schema.subscriptions).set({ nextRenewalDate: newDate }).where(eq(schema.subscriptions.id, subscription.id));

    const second = await reminders.runRenewalReminderJob();
    expect(second.sent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(2);

    const rows = await db
      .select()
      .from(schema.renewalReminders)
      .where(eq(schema.renewalReminders.subscriptionId, subscription.id));
    // Two distinct rows: the original event and the new one — history is
    // never overwritten or reused for the new date.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });

  it("a failed send does not mark the reminder as sent, and it is retried once the claim goes stale", async () => {
    const user = await createTestUser();
    const subscription = await createTestSubscription(user.id, { nextRenewalDate: isoDateOffset(2) });
    // Rejects on every attempt, not just once — sendTransactionalEmail
    // (lib/auth/email.ts) already retries a transient-looking failure up to
    // 3 times internally before giving up; a single mockRejectedValueOnce
    // would just get absorbed by that internal retry and never reach this
    // job's own outer catch.
    sendMailMock.mockRejectedValue(new Error("SMTP rejected"));

    const first = await reminders.runRenewalReminderJob();
    expect(first.sent).toBe(0);
    expect(first.failed).toBe(1);

    const [row] = await db
      .select()
      .from(schema.renewalReminders)
      .where(eq(schema.renewalReminders.subscriptionId, subscription.id));
    expect(row.sentAt).toBeNull(); // claimed but never marked sent

    // A run immediately afterward must NOT retry — the claim isn't stale
    // yet, and a still-recent claim could in principle be a genuinely
    // in-flight concurrent run.
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: "msg-2", accepted: [user.email], rejected: [] });
    const immediateRetry = await reminders.runRenewalReminderJob();
    expect(immediateRetry.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();

    // Simulate the claim having gone stale (as if the failed run happened
    // well in the past) by backdating claimedAt directly.
    await db
      .update(schema.renewalReminders)
      .set({ claimedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(schema.renewalReminders.id, row.id));

    const laterRetry = await reminders.runRenewalReminderJob();
    expect(laterRetry.sent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1); // succeeds on the retry's first attempt

    const [finalRow] = await db
      .select()
      .from(schema.renewalReminders)
      .where(eq(schema.renewalReminders.id, row.id));
    expect(finalRow.sentAt).not.toBeNull();
    expect(finalRow.subscriptionId).toBe(subscription.id); // same event row, reclaimed — not a duplicate
  });

  // ── Cross-user isolation / security ─────────────────────────────────

  it("never sends user A's reminder to user B's address, even when both renew on the same date", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    await createTestSubscription(userA.id, { nextRenewalDate: isoDateOffset(2), name: "A's Netflix" });
    await createTestSubscription(userB.id, { nextRenewalDate: isoDateOffset(2), name: "B's Spotify" });

    await reminders.runRenewalReminderJob();

    const recipients = sendMailMock.mock.calls.map(([msg]) => msg.to);
    expect(recipients).toContain(userA.email);
    expect(recipients).toContain(userB.email);
    const toA = sendMailMock.mock.calls.find(([msg]) => msg.to === userA.email)![0];
    const toB = sendMailMock.mock.calls.find(([msg]) => msg.to === userB.email)![0];
    expect(toA.subject).toContain("A's Netflix");
    expect(toA.subject).not.toContain("B's Spotify");
    expect(toB.subject).toContain("B's Spotify");
    expect(toB.subject).not.toContain("A's Netflix");
  });

  it("an unsubscribe token built for user A does not unsubscribe user B", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const tokenForA = reminders.buildUnsubscribeToken(userA.id)!;

    expect(reminders.verifyUnsubscribeToken(userB.id, tokenForA)).toBe(false);
  });
});
