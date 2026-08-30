import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { inArray, eq } from "drizzle-orm";

// DB-integration coverage for processStripeEvent — the actual side-effects
// a verified Stripe webhook event has on the database (as opposed to
// stripe-webhook.test.ts, which only covers signature verification). Same
// real-DB, skip-if-no-DATABASE_URL pattern as queries.reactivation.test.ts
// and the other *.db.test.ts files in this codebase.
const hasDb = Boolean(process.env.DATABASE_URL);

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

  afterEach(async () => {
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

  async function makeUser(): Promise<string> {
    const [u] = await db
      .insert(schema.users)
      .values({ email: `webhook-${Date.now()}-${Math.random()}@example.com`, passwordHash: "test-hash-not-real" })
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
});
