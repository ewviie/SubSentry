import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for the weekly-digest job — candidate selection
// (weeklyDigestEnabled + emailVerified + cadence), and that lastDigestSentAt
// is only ever advanced on a real attempt. Same "not provable against a
// mock" rationale renewal-reminders.db.test.ts documents on itself. Skips
// cleanly wherever DATABASE_URL isn't set.
const hasDb = Boolean(process.env.DATABASE_URL);

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

describe.skipIf(!hasDb)("weekly digest job (DB integration)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let digestJob: typeof import("./weekly-digest-job");
  let queries: typeof import("./queries");
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    digestJob = await import("./weekly-digest-job");
    queries = await import("./queries");
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

  async function makeUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [row] = await db
      .insert(schema.users)
      .values({
        email: `digest-test-${stamp}@example.com`,
        passwordHash: "test-hash-not-real",
        emailVerified: true,
        weeklyDigestEnabled: true,
        ...overrides,
      })
      .returning();
    createdUserIds.push(row.id);
    return row;
  }

  it("finds a verified, opted-in user who has never received a digest", async () => {
    const user = await makeUser();
    const candidates = await digestJob.findDigestCandidates();
    expect(candidates.some((c) => c.userId === user.id)).toBe(true);
  });

  it("excludes a user who opted out of the weekly digest", async () => {
    const user = await makeUser({ weeklyDigestEnabled: false });
    const candidates = await digestJob.findDigestCandidates();
    expect(candidates.some((c) => c.userId === user.id)).toBe(false);
  });

  it("excludes an unverified email, same posture as the renewal-reminder job", async () => {
    const user = await makeUser({ emailVerified: false });
    const candidates = await digestJob.findDigestCandidates();
    expect(candidates.some((c) => c.userId === user.id)).toBe(false);
  });

  it("excludes a user whose digest was already sent within the last 6 days", async () => {
    const recentlySent = new Date(Date.now() - 2 * 86_400_000);
    const user = await makeUser({ lastDigestSentAt: recentlySent });
    const candidates = await digestJob.findDigestCandidates();
    expect(candidates.some((c) => c.userId === user.id)).toBe(false);
  });

  it("includes a user whose digest was sent more than 6 days ago", async () => {
    const longAgo = new Date(Date.now() - 8 * 86_400_000);
    const user = await makeUser({ lastDigestSentAt: longAgo });
    const candidates = await digestJob.findDigestCandidates();
    expect(candidates.some((c) => c.userId === user.id)).toBe(true);
  });

  it("skips sending (but still advances the cadence) for a user with real spend but nothing genuinely new — watchdog phase", async () => {
    const user = await makeUser();
    await queries.createSubscription(user.id, {
      name: "Real Spend, No New Findings",
      amount: "9.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    // Real recurring spend exists, but nothing duplicate/stale/price-changed
    // — isDigestWorthSending now requires a genuinely new notification, not
    // just a nonzero spend total (the old, looser bar this replaced).
    const result = await digestJob.runWeeklyDigestJob();
    expect(result.skippedEmpty).toBeGreaterThanOrEqual(1);

    const [refreshed] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(refreshed.lastDigestSentAt).not.toBeNull();
  });

  it("sends a real email when a genuinely new finding exists (a real confirmed duplicate)", async () => {
    const user = await makeUser();
    await queries.createSubscription(user.id, {
      name: "Netflix",
      amount: "8.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    await queries.createSubscription(user.id, {
      name: "Netflix Premium",
      amount: "20.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-02-01",
      status: "active",
    });

    const result = await digestJob.runWeeklyDigestJob();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sendMailMock).toHaveBeenCalled();

    const [refreshed] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(refreshed.lastDigestSentAt).not.toBeNull();

    // Retention pass: a real confirmed duplicate carries a real, non-zero
    // savings figure — the digest should say so, using the same total
    // /savings' own "Potential savings from duplicates" callout shows.
    const emailArgs = sendMailMock.mock.calls.find(([msg]) => msg.to === user.email)?.[0];
    expect(emailArgs?.html).toContain("You could potentially save");
  });

  it("first-ever digest sets the monthly-cost snapshot but generates no spend_increased notification (nothing to compare against yet)", async () => {
    const user = await makeUser(); // lastDigestMonthlyCents/lastDigestCurrency both null
    await queries.createSubscription(user.id, {
      name: "Netflix",
      amount: "15.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    await digestJob.runWeeklyDigestJob();

    const [refreshed] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(refreshed.lastDigestMonthlyCents).toBe(1500);
    expect(refreshed.lastDigestCurrency).toBe("usd");

    const notifs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(notifs.some((n) => n.type === "spend_increased")).toBe(false);
  });

  it("generates a real spend_increased notification and sends when the portfolio total genuinely grew since the last digest", async () => {
    const user = await makeUser({ lastDigestMonthlyCents: 1500, lastDigestCurrency: "usd", lastDigestSentAt: new Date(Date.now() - 8 * 86_400_000) });
    await queries.createSubscription(user.id, {
      name: "Netflix",
      amount: "15.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    await queries.createSubscription(user.id, {
      name: "New Gym Membership",
      amount: "40.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    const result = await digestJob.runWeeklyDigestJob();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sendMailMock).toHaveBeenCalled();

    const notifs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    const spendIncreased = notifs.find((n) => n.type === "spend_increased");
    expect(spendIncreased).toBeDefined();
    expect(spendIncreased?.impactCents).toBe(4000); // 5500 (new total) - 1500 (previous)

    const [refreshed] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(refreshed.lastDigestMonthlyCents).toBe(5500);
    expect(refreshed.lastDigestCurrency).toBe("usd");

    // The digest email itself carries a real unsubscribe link now that
    // weeklyDigestEnabled defaults to true — not just a Settings pointer.
    const emailArgs = sendMailMock.mock.calls.at(-1)?.[0];
    expect(emailArgs?.html).toContain("/api/notifications/digest/unsubscribe");
    // Retention pass: "changed by $Y" appended to the total-spend line —
    // $55.00/mo total, +$40.00 vs. the $15.00 previous snapshot.
    expect(emailArgs?.html).toContain("$55.00");
    expect(emailArgs?.html).toContain("+$40.00 vs. last time");
  });

  it("does not generate a spend_increased notification when the total didn't meaningfully grow", async () => {
    const user = await makeUser({ lastDigestMonthlyCents: 1500, lastDigestCurrency: "usd", lastDigestSentAt: new Date(Date.now() - 8 * 86_400_000) });
    await queries.createSubscription(user.id, {
      name: "Netflix",
      amount: "15.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });

    await digestJob.runWeeklyDigestJob();

    const notifs = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(notifs.some((n) => n.type === "spend_increased")).toBe(false);

    const [refreshed] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(refreshed.lastDigestMonthlyCents).toBe(1500);
  });

  it("does not advance lastDigestSentAt when the send fails", async () => {
    const user = await makeUser();
    await queries.createSubscription(user.id, {
      name: "Netflix",
      amount: "8.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-01-01",
      status: "active",
    });
    await queries.createSubscription(user.id, {
      name: "Netflix Premium",
      amount: "20.00",
      currency: "usd",
      billingCycle: "monthly",
      category: "streaming",
      nextRenewalDate: "2099-02-01",
      status: "active",
    });
    // EAUTH is the one error class sendTransactionalEmail never retries
    // (see lib/auth/email.ts's isRetryableSmtpError) — a deterministic,
    // single-attempt failure, unlike a 4xx code which would just succeed on
    // its own internal retry and defeat this test.
    sendMailMock.mockRejectedValue(Object.assign(new Error("Bad credentials"), { code: "EAUTH" }));

    const result = await digestJob.runWeeklyDigestJob();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const [refreshed] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(refreshed.lastDigestSentAt).toBeNull();
  });
});
