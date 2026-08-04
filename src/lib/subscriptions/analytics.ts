import type { Subscription } from "@/lib/db/schema";
import { monthlyCents } from "./money";
import { SOURCE_ANALYTICS_LABELS } from "./analytics-labels";

// Every figure here is derived purely from data already in Postgres — same
// "deterministic, not fabricated" posture as insights.ts (see its own
// comment on computeInsights). There's no historical spend table, so
// "growth over time" is a real, honest proxy: when each subscription was
// added to SubSentry and what it cost then, not a guess at past spending
// this app never observed.

export interface SpendBySourceEntry {
  source: Subscription["source"];
  label: string;
  monthlyCents: number;
  count: number;
}

export function computeSpendBySource(subscriptions: Subscription[]): SpendBySourceEntry[] {
  const active = subscriptions.filter((s) => s.status === "active");
  const bySource = new Map<Subscription["source"], { cents: number; count: number }>();
  for (const s of active) {
    const entry = bySource.get(s.source) ?? { cents: 0, count: 0 };
    entry.cents += monthlyCents(s.amountCents, s.billingCycle);
    entry.count += 1;
    bySource.set(s.source, entry);
  }
  return Array.from(bySource.entries())
    .map(([source, entry]) => ({
      source,
      label: SOURCE_ANALYTICS_LABELS[source],
      monthlyCents: entry.cents,
      count: entry.count,
    }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents);
}

export interface BillingCycleEntry {
  cycle: Subscription["billingCycle"];
  monthlyCents: number;
  count: number;
}

const CYCLE_ORDER: Subscription["billingCycle"][] = ["monthly", "yearly", "quarterly", "weekly"];

export function computeSpendByBillingCycle(subscriptions: Subscription[]): BillingCycleEntry[] {
  const active = subscriptions.filter((s) => s.status === "active");
  const byCycle = new Map<Subscription["billingCycle"], { cents: number; count: number }>();
  for (const s of active) {
    const entry = byCycle.get(s.billingCycle) ?? { cents: 0, count: 0 };
    entry.cents += monthlyCents(s.amountCents, s.billingCycle);
    entry.count += 1;
    byCycle.set(s.billingCycle, entry);
  }
  return CYCLE_ORDER.filter((cycle) => byCycle.has(cycle)).map((cycle) => ({
    cycle,
    monthlyCents: byCycle.get(cycle)!.cents,
    count: byCycle.get(cycle)!.count,
  }));
}

export interface GrowthPoint {
  monthIso: string; // YYYY-MM
  monthLabel: string; // "Jan 2026"
  addedMonthlyCents: number; // sum of monthlyCents for subscriptions created in this month
  cumulativeMonthlyCents: number; // running total through this month
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// Buckets every subscription (active or not — a canceled subscription still
// really was added and did cost money while it lasted) by the month it was
// created, then walks that timeline forward computing a running total. If a
// user has subscriptions predating SubSentry, every one lands in whichever
// month they actually imported/added them — an honest "when did tracked
// spend show up," not a claim about pre-tracking history.
export function computeGrowthOverTime(subscriptions: Subscription[]): GrowthPoint[] {
  if (subscriptions.length === 0) return [];

  const byMonth = new Map<string, number>();
  for (const s of subscriptions) {
    const key = monthKey(s.createdAt);
    byMonth.set(key, (byMonth.get(key) ?? 0) + monthlyCents(s.amountCents, s.billingCycle));
  }

  const sortedKeys = Array.from(byMonth.keys()).sort();
  const firstDate = new Date(`${sortedKeys[0]}-01T00:00:00Z`);
  const lastDate = new Date(`${sortedKeys[sortedKeys.length - 1]}-01T00:00:00Z`);

  const points: GrowthPoint[] = [];
  let cumulative = 0;
  const cursor = new Date(firstDate);
  while (cursor <= lastDate) {
    const key = monthKey(cursor);
    const added = byMonth.get(key) ?? 0;
    cumulative += added;
    points.push({ monthIso: key, monthLabel: monthLabelFormatter.format(cursor), addedMonthlyCents: added, cumulativeMonthlyCents: cumulative });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

export interface RenewalMonthEntry {
  monthIso: string;
  monthLabel: string;
  totalCents: number;
  count: number;
}

// The next 12 calendar months' worth of renewal charges for active
// subscriptions — a real projection from each subscription's own
// nextRenewalDate/billingCycle, not a smoothed average. A yearly
// subscription only appears in the one month it actually renews in; a
// monthly one appears in all 12.
export function computeRenewalsTimeline(subscriptions: Subscription[], today: Date = new Date()): RenewalMonthEntry[] {
  const active = subscriptions.filter((s) => s.status === "active");
  const months: RenewalMonthEntry[] = [];
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  for (let i = 0; i < 12; i++) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    let totalCents = 0;
    let count = 0;

    for (const s of active) {
      const renewal = new Date(`${s.nextRenewalDate}T00:00:00Z`);
      const matchesThisMonth =
        s.billingCycle === "monthly"
          ? true
          : renewal >= monthStart && renewal < monthEnd
            ? true
            : // A yearly/quarterly/weekly subscription's *next* renewal might
              // fall outside this 12-month window entirely (e.g. next
              // renewal is 14 months out) while still recurring within it —
              // approximate by checking whether (monthsFromRenewal % cycle
              // length) lands exactly on this month.
              isOnCycleInMonth(renewal, monthStart, monthEnd, s.billingCycle);
      if (matchesThisMonth) {
        totalCents += s.amountCents;
        count += 1;
      }
    }

    months.push({
      monthIso: monthKey(monthStart),
      monthLabel: monthLabelFormatter.format(monthStart),
      totalCents,
      count,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

const MS_PER_WEEK = 7 * 86_400_000;

function isOnCycleInMonth(renewal: Date, monthStart: Date, monthEnd: Date, cycle: Subscription["billingCycle"]): boolean {
  if (cycle === "weekly") {
    // Walk forward from the next renewal date in 7-day increments to find
    // the first occurrence on/after this month's start, then check whether
    // it still lands before the month ends — a weekly subscription has
    // roughly 4-5 occurrences a month, so (unlike yearly/quarterly) a
    // simple "does the renewal date's month match" check would miss every
    // month except the one its literal next renewal happens to fall in.
    if (renewal >= monthEnd) return false;
    const diffMs = monthStart.getTime() - renewal.getTime();
    const weeksToAdd = diffMs > 0 ? Math.ceil(diffMs / MS_PER_WEEK) : 0;
    const occurrence = new Date(renewal.getTime() + weeksToAdd * MS_PER_WEEK);
    return occurrence >= monthStart && occurrence < monthEnd;
  }
  const cycleMonths = cycle === "yearly" ? 12 : 3; // quarterly
  const diff = monthsBetween(renewal, monthStart);
  return diff >= 0 && diff % cycleMonths === 0;
}

export interface TopMerchantEntry {
  id: string;
  name: string;
  category: Subscription["category"];
  annualCents: number;
}

// Annualizes directly from the billing cycle rather than monthlyCents(...) *
// 12 — monthlyCents() already rounds for weekly/quarterly cycles, so
// multiplying its result by 12 would compound that rounding a second time
// instead of computing the exact annual figure in one step.
function annualizedCents(amountCents: number, cycle: Subscription["billingCycle"]): number {
  switch (cycle) {
    case "monthly":
      return amountCents * 12;
    case "yearly":
      return amountCents;
    case "quarterly":
      return amountCents * 4;
    case "weekly":
      return amountCents * 52;
  }
}

export function computeTopMerchantsBySpend(subscriptions: Subscription[], limit = 5): TopMerchantEntry[] {
  return subscriptions
    .filter((s) => s.status === "active")
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      annualCents: annualizedCents(s.amountCents, s.billingCycle),
    }))
    .sort((a, b) => b.annualCents - a.annualCents)
    .slice(0, limit);
}
