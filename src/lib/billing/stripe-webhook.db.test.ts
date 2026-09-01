import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { inArray, eq } from "drizzle-orm";

// DB-integration coverage for processStripeEvent — the actual side-effects
// a verified Stripe webhook event has on the database (as opposed to
// stripe-webhook.test.ts, which only covers signature verification). Same
// real-DB, skip-if-no-DATABASE_URL pattern as queries.reactivation.test.ts
// and the other *.db.test.ts files in this codebase.
const hasDb = Boolean(process.env.DATABASE_URL);

// Mocked exactly like weekly-digest-job.db.test.ts/renewal-reminders.db.test.ts
// — SMTP_* set so sendTransactionalEmail takes the real-transporter branch,
// needed now that a genuine plan downgrade sends a real email (90-day
// retention audit fix).
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn((_options: unknown) => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransportMock(options) },
}));

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
let savedEnv: Record<string, string | undefined>;

describe.skipIf(!hasDb)("processStripeEvent", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let processStripeEvent: typeof import("./stripe-webhook").processStripeEvent;
  const createdUserIds: string[] = [];
  const createdCheckoutIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    ({ processStripeEvent } = await import("./stripe-webhook"));
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
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (createdCheckoutIds.length > 0) {
      await db.delete(schema.checkoutSessions).where(inArray(schema.checkoutSessions.id, createdCheckoutIds));
      createdCheckoutIds.length = 0;
    }
    if (createdEventIds.length > 0) {
      await db.delete(schema.stripeEvents).where(inArray(schema.stripeEvents.id, createdEventIds));
      createdEventIds.length = 0;
    }
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  });

  async function makeUser(overrides: Partial<{ emailVerified: boolean }> = {}): Promise<string> {
    const [u] = await db
      .insert(schema.users)
      .values({
        email: `webhook-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-hash-not-real",
        emailVerified: overrides.emailVerified ?? true,
      })
      .returning();
    createdUserIds.push(u.id);
    return u.id;
  }

  // P1 fix under test: checkout.session.completed must grant access itself
  // — not just record the checkout for a later, client-triggered
  // /api/billing/activate call that might never happen.
  it("grants Premium access directly on checkout.session.completed, without any /api/billing/activate call", async () => {
    const userId = await makeUser();
    const eventId = `evt_${Date.now()}_${Math.random()}`;
    const checkoutId = `cs_${Date.now()}_${Math.random()}`;
    createdEventIds.push(eventId);
    createdCheckoutIds.push(checkoutId);

    await processStripeEvent({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: checkoutId,
          client_reference_id: userId,
          customer_details: { email: "payer@example.com" },
          customer: "cus_test123",
        },
      },
    });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user.plan).toBe("pro");
    expect(user.stripeCustomerId).toBe("cus_test123");

    const [checkout] = await db
      .select()
      .from(schema.checkoutSessions)
      .where(eq(schema.checkoutSessions.id, checkoutId));
    expect(checkout.status).toBe("completed");
    expect(checkout.userId).toBe(userId);
  });

  it("is idempotent — redelivering the same event id does not double-process or error", async () => {
    const userId = await makeUser();
    const eventId = `evt_${Date.now()}_${Math.random()}`;
    const checkoutId = `cs_${Date.now()}_${Math.random()}`;
    createdEventIds.push(eventId);
    createdCheckoutIds.push(checkoutId);

    const event = {
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: { id: checkoutId, client_reference_id: userId, customer_details: null, customer: null },
      },
    } as const;

    await processStripeEvent(event);
    await processStripeEvent(event); // redelivery — must not throw (unique constraint) or double-grant

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user.plan).toBe("pro");
  });

  it("does not grant access when client_reference_id doesn't resolve to a real user", async () => {
    const eventId = `evt_${Date.now()}_${Math.random()}`;
    const checkoutId = `cs_${Date.now()}_${Math.random()}`;
    createdEventIds.push(eventId);
    createdCheckoutIds.push(checkoutId);

    await processStripeEvent({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: checkoutId,
          client_reference_id: "00000000-0000-0000-0000-000000000000",
          customer_details: null,
          customer: null,
        },
      },
    });

    const [checkout] = await db
      .select()
      .from(schema.checkoutSessions)
      .where(eq(schema.checkoutSessions.id, checkoutId));
    expect(checkout.userId).toBeNull();
  });

  it("does not grant access when client_reference_id is missing entirely", async () => {
    const eventId = `evt_${Date.now()}_${Math.random()}`;
    const checkoutId = `cs_${Date.now()}_${Math.random()}`;
    createdEventIds.push(eventId);
    createdCheckoutIds.push(checkoutId);

    await processStripeEvent({
      id: eventId,
      type: "checkout.session.completed",
      data: { object: { id: checkoutId, client_reference_id: null, customer_details: null, customer: null } },
    });

    const [checkout] = await db
      .select()
      .from(schema.checkoutSessions)
      .where(eq(schema.checkoutSessions.id, checkoutId));
    expect(checkout.userId).toBeNull();
  });

  it("downgrades to free on customer.subscription.deleted, matched by stripeCustomerId", async () => {
    const userId = await makeUser();
    await db.update(schema.users).set({ plan: "pro", stripeCustomerId: "cus_downgrade_test" }).where(eq(schema.users.id, userId));

    const eventId = `evt_${Date.now()}_${Math.random()}`;
    createdEventIds.push(eventId);

    await processStripeEvent({
      id: eventId,
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_test", client_reference_id: null, customer_details: null, customer: "cus_downgrade_test" } },
    });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user.plan).toBe("free");
  });

  it("does not touch a user whose stripeCustomerId doesn't match the deleted subscription's customer", async () => {
    const userId = await makeUser();
    await db.update(schema.users).set({ plan: "pro", stripeCustomerId: "cus_unrelated" }).where(eq(schema.users.id, userId));

    const eventId = `evt_${Date.now()}_${Math.random()}`;
    createdEventIds.push(eventId);

    await processStripeEvent({
      id: eventId,
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_test", client_reference_id: null, customer_details: null, customer: "cus_some_other_customer" } },
    });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user.plan).toBe("pro");
  });

  // 90-day retention audit fix: a real plan downgrade must not be silent —
  // see notification-emails.ts's own buildPlanDowngradedHtml comment for
  // the "silently stop being protected" failure mode this closes.
  describe("plan-downgraded email", () => {
    it("sends a real email to a verified user on a genuine pro -> free transition", async () => {
      const userId = await makeUser({ emailVerified: true });
      const [{ email }] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
      await db.update(schema.users).set({ plan: "pro", stripeCustomerId: "cus_email_test" }).where(eq(schema.users.id, userId));

      const eventId = `evt_${Date.now()}_${Math.random()}`;
      createdEventIds.push(eventId);

      await processStripeEvent({
        id: eventId,
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_test", client_reference_id: null, customer_details: null, customer: "cus_email_test" } },
      });

      const call = sendMailMock.mock.calls.find(([msg]) => msg.to === email);
      expect(call).toBeDefined();
      expect(call![0].subject).toContain("Free");
      expect(call![0].html).toContain("Free plan");
      // Reuses PRO_FEATURES verbatim — proves it's the same list Settings/
      // pricing already show, not a second hand-written copy of it.
      expect(call![0].html).toContain("Automatic daily watchdog sync for connected accounts");
    });

    it("does not send an email when the account was already on free (a no-op re-delivery)", async () => {
      const userId = await makeUser({ emailVerified: true });
      const [{ email }] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
      // Deliberately left on "free" (makeUser's own default) with a
      // stripeCustomerId set — the WHERE clause's own `plan = "pro"` guard
      // is what's under test here.
      await db.update(schema.users).set({ stripeCustomerId: "cus_already_free" }).where(eq(schema.users.id, userId));

      const eventId = `evt_${Date.now()}_${Math.random()}`;
      createdEventIds.push(eventId);

      await processStripeEvent({
        id: eventId,
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_test", client_reference_id: null, customer_details: null, customer: "cus_already_free" } },
      });

      expect(sendMailMock.mock.calls.some(([msg]) => msg.to === email)).toBe(false);
    });

    it("does not send an email to an unverified address", async () => {
      const userId = await makeUser({ emailVerified: false });
      const [{ email }] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
      await db.update(schema.users).set({ plan: "pro", stripeCustomerId: "cus_unverified_test" }).where(eq(schema.users.id, userId));

      const eventId = `evt_${Date.now()}_${Math.random()}`;
      createdEventIds.push(eventId);

      await processStripeEvent({
        id: eventId,
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_test", client_reference_id: null, customer_details: null, customer: "cus_unverified_test" } },
      });

      // The plan still flips regardless of email verification — only the
      // notification is gated, never the actual entitlement change.
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(user.plan).toBe("free");
      expect(sendMailMock.mock.calls.some(([msg]) => msg.to === email)).toBe(false);
    });

    it("a send failure does not throw — the webhook's own DB write already succeeded independently", async () => {
      const userId = await makeUser({ emailVerified: true });
      await db.update(schema.users).set({ plan: "pro", stripeCustomerId: "cus_email_fail_test" }).where(eq(schema.users.id, userId));
      sendMailMock.mockRejectedValueOnce(Object.assign(new Error("Bad credentials"), { code: "EAUTH" }));

      const eventId = `evt_${Date.now()}_${Math.random()}`;
      createdEventIds.push(eventId);

      await expect(
        processStripeEvent({
          id: eventId,
          type: "customer.subscription.deleted",
          data: { object: { id: "sub_test", client_reference_id: null, customer_details: null, customer: "cus_email_fail_test" } },
        }),
      ).resolves.toBeUndefined();

      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(user.plan).toBe("free");
    });
  });
});
