import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, subscriptionPriceHistory, type Subscription, type SubscriptionPriceHistory, type User } from "@/lib/db/schema";
import { MAX_ACTIVE_SUBSCRIPTIONS } from "@/lib/billing/plan";
import { resolveHasReachedSubscriptionLimit } from "@/lib/dev/plan-preview";
import { amountStringToCents, monthlyCents, annualCents, splitByPrimaryCurrency } from "./money";
import { computePriceChangeIfMeaningful } from "./price-history";
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

// The one write path for lastReviewedAt (schema.ts's own comment on that
// column) — called from subscriptions/[id]/page.tsx on every real page
// view. Deliberately does NOT bump `updatedAt` (unlike every other write in
// this file) — updatedAt already means "this row's data last changed,"
// and a review touches no data, just records that a human looked. Fire-
// and-forget from the caller's point of view is fine (the page itself
// doesn't need this to complete before rendering), but this function itself
// still awaits the write — no reason to leave a dangling promise.
export async function markSubscriptionReviewed(userId: string, id: string): Promise<void> {
  await db
    .update(subscriptions)
    .set({ lastReviewedAt: new Date() })
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)));
}

// One "initial" price-history row per newly-created subscription, however
// it was created (manual, quick-add, import) — the starting point every
// later `source: "user_edit"` row (see updateSubscription) is compared
// against. A plain values-builder (not a query itself) so every create path
// below can `.insert(subscriptionPriceHistory).values(...)` with whichever
// executor it's already using (bare `db`, or an open `tx` for the
// limit-checked paths) — a subscription must never exist with zero
// price-history rows once these paths return, so the limit-checked paths
// write this inside the same advisory-locked transaction as the row it
// describes, not as a separate follow-up query that could fail
// independently.
function initialPriceHistoryValues(userId: string, rows: Subscription[]) {
  return rows.map((row) => ({
    subscriptionId: row.id,
    userId,
    amountCents: row.amountCents,
    billingCycle: row.billingCycle,
    currency: row.currency,
    source: "initial" as const,
  }));
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
  await db.insert(subscriptionPriceHistory).values(initialPriceHistoryValues(userId, [row]));
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
    if (await resolveHasReachedSubscriptionLimit(plan, activeCount)) return { kind: "plan" };

    const [row] = await tx
      .insert(subscriptions)
      .values(subscriptionInsertValues(userId, input, source))
      .returning();
    await tx.insert(subscriptionPriceHistory).values(initialPriceHistoryValues(userId, [row]));
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
    if (await resolveHasReachedSubscriptionLimit(plan, activeCount + activeRowCount)) return { kind: "plan" };
    if (rows.length === 0) return { kind: "created", subscriptions: [] };

    const created = await tx
      .insert(subscriptions)
      .values(rows.map((input) => subscriptionInsertValues(userId, input, source)))
      .returning();
    if (created.length > 0) {
      await tx.insert(subscriptionPriceHistory).values(initialPriceHistoryValues(userId, created));
    }
    return { kind: "created", subscriptions: created };
  });
}

// Same shape as price-history.ts's own PriceChange (computeLatestPriceChange's
// return type) — carries the raw before/after amounts, not just the
// percent/annual-delta figures computePriceChangeIfMeaningful alone
// produces, since the price-increase email needs "from $X to $Y," not just
// "up 15%." observedAtIso is "today" here (the edit's own moment), the same
// value the subscriptionPriceHistory row this same write just inserted
// records via its own defaultNow() observedAt.
export interface SubscriptionPriceChange {
  fromCents: number;
  fromBillingCycle: Subscription["billingCycle"];
  toCents: number;
  toBillingCycle: Subscription["billingCycle"];
  currency: string;
  observedAtIso: string;
  percentChange: number;
  annualDeltaCents: number;
}

export type SubscriptionUpdateResult =
  | { kind: "not_found" }
  | { kind: "plan" }
  // priceChange is null whenever this edit didn't touch price at all, or
  // the move was under computePriceChangeIfMeaningful's own materiality bar
  // (< 3%, noise — see price-history.ts). This is a plain, computed fact
  // returned to the caller (api/subscriptions/[id]/route.ts) — queries.ts
  // itself never sends an email or has any opinion on notification
  // preferences; that side effect belongs at the route layer, same
  // separation this codebase's auth routes already keep
  // (sendVerificationEmail is called from the signup route, never from
  // inside a queries.ts-style data function).
  | { kind: "updated"; subscription: Subscription; priceChange: SubscriptionPriceChange | null };

export async function updateSubscription(
  userId: string,
  id: string,
  plan: User["plan"],
  input: SubscriptionUpdate,
): Promise<SubscriptionUpdateResult> {
  const values: Partial<typeof subscriptions.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) values.name = input.name;
  if (input.amount !== undefined) values.amountCents = amountStringToCents(input.amount);
  if (input.currency !== undefined) values.currency = input.currency;
  if (input.billingCycle !== undefined) values.billingCycle = input.billingCycle;
  if (input.category !== undefined) values.category = input.category;
  if (input.nextRenewalDate !== undefined) values.nextRenewalDate = input.nextRenewalDate;
  if (input.status !== undefined) values.status = input.status;
  if (input.notes !== undefined) values.notes = input.notes || null;

  // Reactivating a subscription (status -> "active" from something else,
  // e.g. "cancelled"/"paused") re-enters the active count the free plan
  // caps, exactly like creating a new one does — without this check, a
  // free-plan user could cancel then reactivate (or reactivate several
  // already-cancelled rows) to exceed FREE_PLAN_SUBSCRIPTION_LIMIT entirely
  // through PATCH, bypassing the limit createSubscriptionWithLimitCheck
  // enforces on the create path. Inert while BETA_ALL_ACCESS is on and no
  // dev preview overrides it (see lib/billing/plan.ts and
  // lib/dev/plan-preview.ts), but must hold the moment the beta ends.
  const mayActivate = input.status === "active";

  // Only pay for the extra read/transaction when this edit could possibly
  // touch price or reactivate a subscription — the common edits (rename,
  // recategorize, change renewal date, cancelling) never need either.
  // billingCycle is included, not just amount/currency: amountCents is
  // unit-less on its own ("$10" means something very different at monthly
  // vs. yearly cadence), so a cycle-only change (same amountCents,
  // different cadence) is just as real a price change as an amount edit —
  // see schema.ts's subscriptionPriceHistory comment.
  const touchesPrice = input.amount !== undefined || input.currency !== undefined || input.billingCycle !== undefined;
  if (!touchesPrice && !mayActivate) {
    const [row] = await db
      .update(subscriptions)
      .set(values)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
      .returning();
    return row ? { kind: "updated", subscription: row, priceChange: null } : { kind: "not_found" };
  }

  // The pre-edit read, the limit check, the update, and the price-history
  // insert all run inside one advisory-locked transaction — same per-user
  // lock createSubscriptionWithLimitCheck uses, for the same reason:
  // without it, two concurrent edits for the same account could each read
  // the same "before" state ahead of either committing, letting one edit's
  // price-history comparison or plan-limit count use a value that was never
  // actually current (a lost-update race on the *comparison*, not on the
  // subscriptions row itself, which Postgres's own UPDATE already
  // serializes correctly). Caught in CodeRabbit review.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const [before] = await tx
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
      .limit(1);

    if (!before) return { kind: "not_found" };

    if (mayActivate && before.status !== "active") {
      // A targeted COUNT, not the full-row fetch createSubscription{,Bulk}WithLimitCheck
      // above use — this check only ever needs the one number, unlike
      // those two, which also need the actual row count (regardless of
      // status) for the defensive MAX_ACTIVE_SUBSCRIPTIONS ceiling. Pulling
      // every row over the wire inside an advisory-locked transaction just
      // to produce one integer was real, wasted I/O on a hot,
      // security-sensitive path (release-review finding #9).
      const [{ value: activeCount }] = await tx
        .select({ value: count() })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active"), ne(subscriptions.id, id)));
      if (await resolveHasReachedSubscriptionLimit(plan, activeCount)) return { kind: "plan" };
    }

    const [row] = await tx
      .update(subscriptions)
      .set(values)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
      .returning();

    if (!row) return { kind: "not_found" };

    let priceChange: SubscriptionPriceChange | null = null;
    if (
      row.amountCents !== before.amountCents ||
      row.currency !== before.currency ||
      row.billingCycle !== before.billingCycle
    ) {
      await tx.insert(subscriptionPriceHistory).values({
        subscriptionId: row.id,
        userId,
        amountCents: row.amountCents,
        billingCycle: row.billingCycle,
        currency: row.currency,
        source: input.priceHistorySource ?? "user_edit",
      });
      // Same materiality bar (>=3%, currency-matched) the import-side
      // reconciliation proposal already uses — a manual edit that
      // genuinely raises the price deserves the same price-increase email
      // an import-detected one would trigger, not a separate, looser rule.
      // computePriceChangeIfMeaningful decides IF this counts; the raw
      // before/after amounts (never returned by that function — it only
      // ever produces percentChange/annualDeltaCents) are carried through
      // here so the email can say "from $X to $Y," not just "up 15%."
      const candidate = computePriceChangeIfMeaningful(
        { amountCents: before.amountCents, billingCycle: before.billingCycle, currency: before.currency },
        { amountCents: row.amountCents, billingCycle: row.billingCycle, currency: row.currency },
      );
      if (candidate) {
        priceChange = {
          fromCents: before.amountCents,
          fromBillingCycle: before.billingCycle,
          toCents: row.amountCents,
          toBillingCycle: row.billingCycle,
          currency: row.currency,
          observedAtIso: new Date().toISOString().slice(0, 10),
          percentChange: candidate.percentChange,
          annualDeltaCents: candidate.annualDeltaCents,
        };
      }
    }

    return { kind: "updated", subscription: row, priceChange };
  });
}

// Ascending by observedAt — callers read this as a timeline (see
// subscription-summary.tsx's price-change section), oldest first, same
// order a chart or "here's what changed, in order" list would want. Scoped
// by both userId and subscriptionId directly on this table's own columns
// (see schema.ts's comment on why userId is denormalized here) rather than
// via a join through `subscriptions` — one indexed lookup, no way to leak
// another user's price history even if the subscriptionId argument were
// somehow wrong.
export async function getPriceHistory(userId: string, subscriptionId: string): Promise<SubscriptionPriceHistory[]> {
  return db
    .select()
    .from(subscriptionPriceHistory)
    .where(and(eq(subscriptionPriceHistory.userId, userId), eq(subscriptionPriceHistory.subscriptionId, subscriptionId)))
    .orderBy(asc(subscriptionPriceHistory.observedAt));
}

// One query for every price-history row this user has, grouped by
// subscriptionId — the bulk counterpart to getPriceHistory above. Feeds
// insights-engine's EngineContext.priceHistoryBySubscriptionId
// (health.price_increases): looping getPriceHistory per active
// subscription there would turn one dashboard load into N+1 queries.
// Scoped by this table's own denormalized userId column (same reasoning as
// getPriceHistory), not a join through `subscriptions`.
export async function getAllPriceHistoryForUser(userId: string): Promise<Map<string, SubscriptionPriceHistory[]>> {
  const rows = await db
    .select()
    .from(subscriptionPriceHistory)
    .where(eq(subscriptionPriceHistory.userId, userId))
    .orderBy(asc(subscriptionPriceHistory.observedAt));

  const bySubscriptionId = new Map<string, SubscriptionPriceHistory[]>();
  for (const row of rows) {
    const existing = bySubscriptionId.get(row.subscriptionId);
    if (existing) existing.push(row);
    else bySubscriptionId.set(row.subscriptionId, [row]);
  }
  return bySubscriptionId;
}

// Retention pass: the renewal-reminders job's own bulk lookup — that job
// iterates candidate subscriptions spanning many different users (unlike
// getAllPriceHistoryForUser above, which is already scoped to one), so
// there's no single userId to key this by. One IN(...) query for the
// whole candidate batch (bounded the same way the candidates themselves
// are — see renewal-reminders.ts's own MAX_LEAD_DAYS/cap reasoning), not
// one query per subscription: the exact N+1 this app's own conventions
// already avoid everywhere else (see getAllPriceHistoryForUser's own
// comment). An empty input returns an empty map without a wasted round
// trip.
export async function getPriceHistoryForSubscriptionIds(subscriptionIds: string[]): Promise<Map<string, SubscriptionPriceHistory[]>> {
  const bySubscriptionId = new Map<string, SubscriptionPriceHistory[]>();
  if (subscriptionIds.length === 0) return bySubscriptionId;

  const rows = await db
    .select()
    .from(subscriptionPriceHistory)
    .where(inArray(subscriptionPriceHistory.subscriptionId, subscriptionIds))
    .orderBy(asc(subscriptionPriceHistory.observedAt));

  for (const row of rows) {
    const existing = bySubscriptionId.get(row.subscriptionId);
    if (existing) existing.push(row);
    else bySubscriptionId.set(row.subscriptionId, [row]);
  }
  return bySubscriptionId;
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
  // The currency monthlyTotalCents/annualTotalCents/categoryBreakdown are
  // actually denominated in — see splitByPrimaryCurrency's own comment.
  // Never assume "usd": a single-currency account's own currency is
  // whatever it is, and formatCents needs to be told, not left to its
  // "usd" default, or a EUR/GBP-only account's real numbers would render
  // with a $ sign no subscription of theirs actually uses.
  currency: string;
  // How many active subscriptions exist in a currency other than
  // `currency` above and are therefore NOT included in monthlyTotalCents/
  // annualTotalCents/categoryBreakdown — 0 for the overwhelmingly common
  // single-currency case. The UI must disclose this count somewhere
  // whenever it's nonzero rather than silently under-stating spend.
  otherCurrencyActiveCount: number;
  upcomingRenewals: Subscription[];
  categoryBreakdown: CategoryBreakdownEntry[];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const all = await listSubscriptions(userId);
  const active = all.filter((s) => s.status === "active");

  // monthlyTotalCents/annualTotalCents/categoryBreakdown below are computed
  // from `primary` only, never from `active` directly — summing raw cents
  // across different currencies and labeling the result with just one
  // currency symbol would be a fabricated number wearing a real one's
  // formatting (this app has no exchange-rate source — see
  // splitByPrimaryCurrency's own comment). `other.length` is returned as
  // otherCurrencyActiveCount so the UI can disclose what's excluded rather
  // than silently under-stating spend for the (real, if uncommon) case of
  // an account with a mix — e.g. one subscription entered or imported in a
  // different currency from the rest.
  const { currency, included: primary, excluded: other } = splitByPrimaryCurrency(active);

  const monthlyTotalCents = primary.reduce(
    (sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle),
    0,
  );
  // Not monthlyTotalCents * 12 — see money.ts's own annualCents comment.
  // Summing each subscription's own exact annual figure directly (instead
  // of scaling an already-rounded monthly total) is the only way this
  // matches, cent for cent, what a yearly-billed subscription's own stored
  // price actually is.
  const annualTotalCents = primary.reduce(
    (sum, s) => sum + annualCents(s.amountCents, s.billingCycle),
    0,
  );

  const todayISO = isoDate(new Date());
  const in30ISO = isoDate(new Date(Date.now() + 30 * 86_400_000));
  const upcomingRenewals = active
    .filter((s) => s.nextRenewalDate >= todayISO && s.nextRenewalDate <= in30ISO)
    .sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate));

  const byCategory = new Map<Subscription["category"], number>();
  for (const s of primary) {
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
    annualTotalCents,
    // "usd" only when there are zero primary-currency subscriptions to
    // read a real one from (splitByPrimaryCurrency returns null currency
    // only for an empty input) — matches formatCents' own "usd" default,
    // not a claim that this account's currency actually is USD.
    currency: currency ?? "usd",
    otherCurrencyActiveCount: other.length,
    upcomingRenewals,
    categoryBreakdown,
  };
}
