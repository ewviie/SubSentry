import type { Subscription, SubscriptionPriceHistory, Notification, RealizedSavingsRecord } from "@/lib/db/schema";
import { monthlyCents, splitByPrimaryCurrency } from "./money";
import { daysUntilRenewal } from "./filters";
import { computeCreepingCostTrailing12Months } from "./price-history";
import { computeTotalPotentialSavings, computeRealizedSavings, type SavingsRecommendation, type RealizedSavings } from "./savings";
import { summarizeTopChanges } from "@/lib/notifications/ranking";

// "Your week with SubSentry" — Watchdog phase rework. Previously this
// re-derived "what's new" from subscriptions/priceHistory/savingsRecommendations
// independently of the notification center, which risked the two surfaces
// disagreeing about what actually counts as new, and (worse) meant a quiet
// week with zero real findings still "justified" sending purely because
// monthlyCents was nonzero — exactly the "here are the same things you
// already saw" spam this phase was told to avoid. Now the digest is built
// directly from this user's own notifications created since their last
// digest (see notifications/queries.ts's own listNotificationsSince) —
// the same persisted, deduped record the bell/notification center already
// show, so "new since last time" can never drift between the two, and a
// week with nothing new genuinely has nothing to report.
//
// upcomingRenewalsCount/creepingCost are the two exceptions, computed
// directly from subscriptions/priceHistory rather than from notifications
// — deliberately: upcoming renewals are routine, expected information (the
// brief's own instruction: they belong in the calendar/dashboard/digest,
// not the notification feed at all), and creeping cost is a standing
// figure, not a "new event." Both are genuinely useful digest content even
// in a week with zero new notifications, but neither alone makes a digest
// worth sending (see isDigestWorthSending below) — a routine renewal list
// repeated every week with nothing else would be exactly the "same things
// you already saw" spam this phase warns against.
export interface WeeklyDigestSummary {
  monthlyCents: number;
  currency: string | null;
  upcomingRenewalsCount: number;
  // Retention pass: the brief's own canonical example ("You have $X/month in
  // subscriptions renewing soon") — a count alone doesn't answer "should I
  // care." Same primary-currency-only honesty as monthlyCents: 0 whenever
  // there's nothing upcoming, never a partial cross-currency sum.
  upcomingRenewalsCents: number;
  creepingCostAnnualDeltaCents: number | null;
  creepingCostCurrency: string | null;
  // Retention pass: the brief's own "Your recurring spending changed by
  // $Y" — a passive, always-computed figure (like creepingCost above),
  // deliberately separate from the spend_increased notification's own
  // $0.50 minimum-delta gate (notifications/generate.ts). That gate exists
  // to keep the notification feed free of rounding noise; this digest line
  // has no such bar to clear, because a digest that's already worth
  // sending (see isDigestWorthSending below) can honestly report "and your
  // total didn't really move" as context, the same way creepingCost is
  // shown even in a week its own figure is small. Null on a user's first
  // digest (nothing to compare against) or when the portfolio's primary
  // currency changed since the last one (never a cross-currency delta).
  monthlyDeltaCents: number | null;
  // Retention pass: "You could potentially save $X/year" — the exact
  // figure /savings' own "Potential savings from duplicates" callout
  // already shows (computeTotalPotentialSavings, savings.ts), read here
  // rather than a second, looser estimate. Deliberately NOT the broader
  // functional-overlap/small-cluster review-tier findings that function
  // already excludes — see its own comment for why only confirmed
  // duplicates get a dollar figure attached at all. Its own currency,
  // tracked separately (same reason creepingCostCurrency is separate from
  // `currency` above) — a duplicate pair can be in a currency that isn't
  // this portfolio's overall primary one.
  potentialSavingsYearlyCents: number;
  potentialSavingsCurrency: string | null;
  newNotificationCounts: Partial<Record<Notification["type"], number>>;
  totalNewNotifications: number;
  // The single most-worth-mentioning new item this week, or null when
  // there's nothing new — the highest-severity, highest-impact notification
  // among the ones counted above (warning before info, then real dollar
  // impact), via the same shared ranking notifications/ranking.ts's
  // summarizeTopChanges uses everywhere else — never a second,
  // digest-specific "what matters most" heuristic layered on top of what
  // the notification center already decided was worth flagging.
  // `secondary` (User Value Journey Audit, opportunity #1 revised): the
  // second-highest-ranked item this week, when a real one exists — lets the
  // digest compose "X, and also Y" instead of only ever naming one thing,
  // using the exact same ranking, never a second selection heuristic.
  topPriorityNotification: { title: string; body: string; secondary: { title: string; body: string } | null } | null;
  // User Value Journey Audit, opportunity #1 revised: the permanent
  // realized-savings total (savings.ts's computeRealizedSavings, over the
  // persisted realizedSavings ledger — schema.ts) — never derived from
  // this week's `newNotifications` the way every other field above is,
  // since a cancellation from months ago is still real, provable value even
  // in a week nothing changed. Read here purely so the digest can state it
  // when a digest IS already going out for other reasons (see
  // isDigestWorthSending's own comment: this field is never itself a reason
  // to send one — a static total restated every week with nothing else new
  // is exactly the spam this phase already guards against).
  realizedSavings: RealizedSavings;
}

const UPCOMING_RENEWAL_WINDOW_DAYS = 7;

// Retention pass: the one figure both computeWeeklyDigestSummary below and
// the weekly-digest job's own "did the total change since last time" check
// (weekly-digest-job.ts) need — extracted so both read the exact same
// number computed the exact same way, rather than the job re-deriving its
// own copy of "sum active subscriptions in the primary currency" alongside
// this function's already-existing one.
export function computeMonthlyTotal(subscriptions: Subscription[]): { cents: number; currency: string | null } {
  const active = subscriptions.filter((s) => s.status === "active");
  const { currency, included: primaryActive } = splitByPrimaryCurrency(active);
  const cents = primaryActive.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
  return { cents, currency };
}

export function computeWeeklyDigestSummary(
  subscriptions: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
  newNotifications: Notification[],
  savingsRecommendations: SavingsRecommendation[],
  // The prior digest's own observed total (users.lastDigestMonthlyCents/
  // lastDigestCurrency) — null on a user's first-ever digest.
  previous: { monthlyCents: number; currency: string } | null,
  now: Date = new Date(),
  // Defaulted to [] (trailing, optional) rather than inserted earlier in
  // the parameter list, specifically so every existing call site (this
  // file's own test suite, weekly-digest-job.ts before this change) keeps
  // compiling unchanged — a caller that doesn't pass this simply gets
  // realizedSavings' own honest zero-state (computeRealizedSavings([])).
  realizedSavingsRecords: RealizedSavingsRecord[] = [],
): WeeklyDigestSummary {
  const active = subscriptions.filter((s) => s.status === "active");
  const { cents: monthlyTotal, currency } = computeMonthlyTotal(subscriptions);
  const monthlyDeltaCents = previous !== null && currency !== null && previous.currency === currency ? monthlyTotal - previous.monthlyCents : null;

  const upcomingActive = active.filter((s) => {
    const days = daysUntilRenewal(s);
    return days >= 0 && days <= UPCOMING_RENEWAL_WINDOW_DAYS;
  });
  const upcomingRenewalsCount = upcomingActive.length;
  // Same "one honest currency total" posture monthlyTotal above already
  // uses: summed only across the upcoming subscriptions that are actually
  // in this portfolio's primary currency, never added across currencies.
  const upcomingRenewalsCents = upcomingActive
    .filter((s) => s.currency === currency)
    .reduce((sum, s) => sum + s.amountCents, 0);

  const creepingCost = computeCreepingCostTrailing12Months(subscriptions, priceHistoryBySubscriptionId, now);
  const potentialSavings = computeTotalPotentialSavings(savingsRecommendations);

  const newNotificationCounts: WeeklyDigestSummary["newNotificationCounts"] = {};
  for (const n of newNotifications) {
    newNotificationCounts[n.type] = (newNotificationCounts[n.type] ?? 0) + 1;
  }

  const topPriorityNotification = summarizeTopChanges(newNotifications);
  const realizedSavings = computeRealizedSavings(realizedSavingsRecords);

  return {
    monthlyCents: monthlyTotal,
    currency,
    upcomingRenewalsCount,
    upcomingRenewalsCents,
    creepingCostAnnualDeltaCents: creepingCost?.annualDeltaCents ?? null,
    creepingCostCurrency: creepingCost?.currency ?? null,
    monthlyDeltaCents,
    potentialSavingsYearlyCents: potentialSavings.yearlyCents,
    potentialSavingsCurrency: potentialSavings.currency,
    newNotificationCounts,
    totalNewNotifications: newNotifications.length,
    topPriorityNotification,
    realizedSavings,
  };
}

// Watchdog phase: "if there is nothing genuinely useful/new, don't send" —
// the bar is now strictly "at least one real notification since the last
// digest," not "has any recurring spend" (the old, much looser bar this
// replaced). monthlyCents/upcomingRenewalsCount/creepingCost/monthlyDeltaCents/
// potentialSavingsYearlyCents are all still shown in a digest that IS sent,
// but none of them alone justifies sending one — a routine renewal list, an
// unchanging spend total, or a standing savings opportunity nobody's acted
// on yet, repeated every week with nothing else, is exactly the "here's
// what you already saw" spam this phase was told to avoid. realizedSavings
// is deliberately excluded from this check for the identical reason — it's
// a standing total, not a new event, so it can never by itself turn a quiet
// week into a sent digest; it only ever rides along on one that's already
// going out.
export function isDigestWorthSending(summary: WeeklyDigestSummary): boolean {
  return summary.totalNewNotifications > 0;
}
