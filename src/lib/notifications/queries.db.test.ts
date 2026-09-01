import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { eq, inArray } from "drizzle-orm";

// DB-integration coverage for the notifications data layer: idempotent
// insert, unread-scoped ranking, activity-summary grouping, and — most
// importantly — that read/mark-read never crosses a user boundary. Same
// "not provable against a mock" rationale every other .db.test.ts in this
// repo documents. Skips cleanly wherever DATABASE_URL isn't set.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("notifications queries (DB integration)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let queries: typeof import("./queries");
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    schema = await import("@/lib/db/schema");
    queries = await import("./queries");
  });

  afterEach(async () => {
    if (createdUserIds.length === 0) return;
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    createdUserIds.length = 0;
  });

  async function makeUser() {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [row] = await db
      .insert(schema.users)
      .values({ email: `notif-test-${stamp}@example.com`, passwordHash: "test-hash-not-real" })
      .returning();
    createdUserIds.push(row.id);
    return row.id;
  }

  function candidate(overrides: Partial<Parameters<typeof queries.insertNotifications>[1][number]> = {}) {
    return {
      type: "stale_subscription" as const,
      title: "Test",
      body: "Test body",
      severity: "info" as const,
      impactCents: null,
      currency: null,
      subscriptionId: null,
      actionHref: null,
      dedupeKey: `test-${Math.random()}`,
      ...overrides,
    };
  }

  it("insertNotifications is idempotent on dedupeKey — a repeat call inserts nothing new", async () => {
    const userId = await makeUser();
    const c = candidate({ dedupeKey: "dedupe-once" });
    await queries.insertNotifications(userId, [c]);
    await queries.insertNotifications(userId, [c]);

    const all = await queries.listNotifications(userId, { isPremium: true });
    expect(all).toHaveLength(1);
  });

  it("getAttentionItems ranks by severity then impact, and only ever returns unread rows", async () => {
    const userId = await makeUser();
    await queries.insertNotifications(userId, [
      candidate({ dedupeKey: "low-info", severity: "info", impactCents: 100, currency: "usd", title: "Low info" }),
      candidate({ dedupeKey: "high-warning", severity: "warning", impactCents: 500, currency: "usd", title: "High warning" }),
      candidate({ dedupeKey: "already-read", severity: "warning", impactCents: 999999, currency: "usd", title: "Already read" }),
    ]);
    const all = await queries.listNotifications(userId, { isPremium: true });
    const alreadyRead = all.find((n) => n.title === "Already read")!;
    await queries.markNotificationRead(userId, alreadyRead.id);

    const attention = await queries.getAttentionItems(userId);
    expect(attention.map((n) => n.title)).toEqual(["High warning", "Low info"]); // read one excluded, warning ranks first
  });

  it("getRecentActivitySummary groups by type and counts every notification, read or not", async () => {
    const userId = await makeUser();
    await queries.insertNotifications(userId, [
      candidate({ dedupeKey: "a", type: "price_increase" }),
      candidate({ dedupeKey: "b", type: "price_increase" }),
      candidate({ dedupeKey: "c", type: "stale_subscription" }),
    ]);
    const all = await queries.listNotifications(userId, { isPremium: true });
    await queries.markNotificationRead(userId, all[0].id); // read status shouldn't affect the count

    const summary = await queries.getRecentActivitySummary(userId);
    expect(summary.totalCount).toBe(3);
    expect(summary.countByType.price_increase).toBe(2);
    expect(summary.countByType.stale_subscription).toBe(1);
  });

  it("markNotificationRead cannot mark another user's notification (ownership scoped)", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await queries.insertNotifications(userA, [candidate({ dedupeKey: "owned-by-a" })]);
    const [row] = await queries.listNotifications(userA, { isPremium: true });

    const found = await queries.markNotificationRead(userB, row.id);
    expect(found).toBe(false);

    const [unchanged] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, row.id));
    expect(unchanged.readAt).toBeNull();
  });

  it("markAllNotificationsRead only ever touches the calling user's own rows", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await queries.insertNotifications(userA, [candidate({ dedupeKey: "a1" })]);
    await queries.insertNotifications(userB, [candidate({ dedupeKey: "b1" })]);

    await queries.markAllNotificationsRead(userA);

    const bUnread = await queries.getUnreadNotificationCount(userB);
    expect(bUnread).toBe(1);
    const aUnread = await queries.getUnreadNotificationCount(userA);
    expect(aUnread).toBe(0);
  });
});
