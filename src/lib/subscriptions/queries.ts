import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, type Subscription, type User } from "@/lib/db/schema";
import { MAX_ACTIVE_SUBSCRIPTIONS, hasReachedSubscriptionLimit } from "@/lib/billing/plan";
import { amountStringToCents, monthlyCents } from "./money";
import type { SubscriptionInput, SubscriptionUpdate } from "./validation";
import type { SubscriptionSource } from "./source";

function subscriptionInsertValues(userId: string, input: SubscriptionInput, source: SubscriptionSource) {
  return {
    userId,
    name: input.name,
    amountCents: amountStringToCents(input.amount),
    currency: input.currency,
    billingCycle: input.billingCycle,
    category: input.category,
    nextRenewalDate: input.nextRenewalDate,
    status: input.status,
    notes: input.notes || null,
    source,
  };
}

export async function listSubscriptions(userId: string): Promise<Subscription[]> {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(asc(subscriptions.nextRenewalDate));
}

export async function getSubscription(
  userId: string,
  id: string,
): Promise<Subscription | undefined> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
    .limit(1);
  return row;
}

// No limit check, no lock — a plain single-row insert. Used directly only
// by test setup (queries.idor.test.ts), which needs a row to exist without
// caring about plan/ceiling rules. Production write paths go through
// createSubscriptionWithLimitCheck below instead.
export async function createSubscription(
  userId: string,
  input: SubscriptionInput,
  source: SubscriptionSource = "manual",
): Promise<Subscription> {
  const [row] = await db
    .insert(subscriptions)
    .values(subscriptionInsertValues(userId, input, source))
    .returning();
  return row;
}

export type SubscriptionLimitResult =
  | { kind: "ceiling" }
  | { kind: "plan" }
  | { kind: "created"; subscription: Subscription };

export type SubscriptionsBulkLimitResult =
  | { kind: "ceiling" }
  | { kind: "plan" }
  | { kind: "created"; subscriptions: Subscription[] };

// Both functions below wrap their count-check-then-insert in a transaction
// holding a Postgres advisory lock scoped to the target user for the
// transaction's duration. Without this, two concurrent calls for the same
// account (a double-submit, a raced retry, a scripted burst) could each
// read "under the limit" before either's insert committed, letting one
// account exceed MAX_ACTIVE_SUBSCRIPTIONS — or, once BETA_ALL_ACCESS
// (lib/billing/plan.ts) is turned off, exceed the free-plan cap — by
// simply racing requests instead of respecting either limit. The lock
// serializes concurrent callers for the *same* user; a second request for
// that user blocks until the first's transaction commits or rolls back, so
// it always sees the first's row in its own count. hashtext() can
// theoretically collide between two different users' ids; that only costs
// harmless extra serialization between unrelated accounts (they still each
// get a correct answer), never an incorrect result, since the lock is a
// mutex around one user's own check-then-insert, not a data partition.
export async function createSubscriptionWithLimitCheck(
  userId: string,
  plan: User["plan"],
  input: SubscriptionInput,
  source: SubscriptionSource = "manual",
): Promise<SubscriptionLimitResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    // The free-plan check only applies to free users and only counts
    // "active" rows, matching the same definition getDashboardData() uses
    // elsewhere — a canceled/paused subscription shouldn't count against it
    // any more than it counts toward spend totals. The defensive ceiling
    // below is different: it must count every row regardless of status,
    // since a paused/canceled subscription still occupies a row and costs
    // the same to store and query.
    const existing = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    const activeCount = existing.filter((s) => s.status === "active").length;

    if (existing.length >= MAX_ACTIVE_SUBSCRIPTIONS) return { kind: "ceiling" };
    if (hasReachedSubscriptionLimit(plan, activeCount)) return { kind: "plan" };

    const [row] = await tx
      .insert(subscriptions)
      .values(subscriptionInsertValues(userId, input, source))
      .returning();
    return { kind: "created", subscription: row };
  });
}

// Same lock/limit reasoning as createSubscriptionWithLimitCheck above,
// against a batch total instead of one row — used by /api/imports/confirm.
// A single multi-row insert (not a loop of per-row inserts): Postgres makes
// one multi-row INSERT atomic on its own, and this needs the transaction's
// own `tx` handle anyway to stay inside the advisory lock.
export async function createSubscriptionsBulkWithLimitCheck(
  userId: string,
  plan: User["plan"],
  rows: SubscriptionInput[],
  source: SubscriptionSource,
): Promise<SubscriptionsBulkLimitResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const existing = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    const activeCount = existing.filter((s) => s.status === "active").length;
    const activeRowCount = rows.filter((row) => row.status === "active").length;

    if (existing.length + rows.length > MAX_ACTIVE_SUBSCRIPTIONS) return { kind: "ceiling" };
    if (hasReachedSubscriptionLimit(plan, activeCount + activeRowCount)) return { kind: "plan" };
    if (rows.length === 0) return { kind: "created", subscriptions: [] };

    const created = await tx
      .insert(subscriptions)
      .values(rows.map((input) => subscriptionInsertValues(userId, input, source)))
      .returning();
    return { kind: "created", subscriptions: created };
  });
}

export async function updateSubscription(
  userId: string,
  id: string,
  input: SubscriptionUpdate,
): Promise<Subscription | undefined> {
  const values: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) values.name = input.name;
  if (input.amount !== undefined) values.amountCents = amountStringToCents(input.amount);
  if (input.currency !== undefined) values.currency = input.currency;
  if (input.billingCycle !== undefined) values.billingCycle = input.billingCycle;
  if (input.category !== undefined) values.category = input.category;
  if (input.nextRenewalDate !== undefined) values.nextRenewalDate = input.nextRenewalDate;
  if (input.status !== undefined) values.status = input.status;
  if (input.notes !== undefined) values.notes = input.notes || null;

  const [row] = await db
    .update(subscriptions)
    .set(values)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
    .returning();
  return row;
}

export async function deleteSubscription(userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
    .returning({ id: subscriptions.id });
  return result.length > 0;
}

export interface CategoryBreakdownEntry {
  category: Subscription["category"];
  monthlyCents: number;
}

export interface DashboardData {
  subscriptions: Subscription[];
  activeCount: number;
  monthlyTotalCents: number;
  annualTotalCents: number;
  upcomingRenewals: Subscription[];
  categoryBreakdown: CategoryBreakdownEntry[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const all = await listSubscriptions(userId);
  const active = all.filter((s) => s.status === "active");

  const monthlyTotalCents = active.reduce(
    (sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle),
    0,
  );

  const todayISO = isoDate(new Date());
  const in30ISO = isoDate(new Date(Date.now() + 30 * 86_400_000));
  const upcomingRenewals = active
    .filter((s) => s.nextRenewalDate >= todayISO && s.nextRenewalDate <= in30ISO)
    .sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate));

  const byCategory = new Map<Subscription["category"], number>();
  for (const s of active) {
    byCategory.set(
      s.category,
      (byCategory.get(s.category) ?? 0) + monthlyCents(s.amountCents, s.billingCycle),
    );
  }
  const categoryBreakdown = Array.from(byCategory.entries())
    .map(([category, cents]) => ({ category, monthlyCents: cents }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents);

  return {
    subscriptions: all,
    activeCount: active.length,
    monthlyTotalCents,
    annualTotalCents: monthlyTotalCents * 12,
    upcomingRenewals,
    categoryBreakdown,
  };
}
