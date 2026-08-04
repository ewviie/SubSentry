import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, type Subscription } from "@/lib/db/schema";
import { amountStringToCents, monthlyCents } from "./money";
import type { SubscriptionInput, SubscriptionUpdate } from "./validation";
import type { SubscriptionSource } from "./source";

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

export async function createSubscription(
  userId: string,
  input: SubscriptionInput,
  source: SubscriptionSource = "manual",
): Promise<Subscription> {
  const [row] = await db
    .insert(subscriptions)
    .values({
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
    })
    .returning();
  return row;
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
