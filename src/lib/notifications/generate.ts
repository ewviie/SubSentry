import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";
import type { PriceChangeProposal } from "@/lib/imports/types";
import { formatCents } from "@/lib/subscriptions/money";
import { daysUntilRenewal } from "@/lib/subscriptions/filters";
import { findStaleSubscriptions, STALE_THRESHOLD_DAYS } from "@/lib/subscriptions/staleness";
import { computePortfolioPriceChanges } from "@/lib/subscriptions/price-history";
import { getSavingsPriority, splitSavingsRecommendationsByPlan, type SavingsRecommendation } from "@/lib/subscriptions/savings";
import type { NotificationCandidate } from "./types";

// The Notification/Intelligence Center's whole detection layer. Every
// function here reads data an existing engine already computed — this file
// never re-derives a duplicate check, a price comparison, or a staleness
// rule of its own. That's deliberate (the engineering brief's own "avoid
// duplicate intelligence engines"): this module's only job is turning
// findings other modules already trust into a persisted, actionable,
// timestamped notification.
//
// Callers pass in what they've already computed (subscriptions, price
// history, savings recommendations) rather than this file recomputing any
// of it itself — the same "accept already-loaded data" shape
// dashboard/page.tsx and savings/page.tsx already use for their own
// Promise.all reads, and it means this function can never disagree with
// what the dashboard/savings page showed the same request.
export interface GenerateNotificationsInput {
  subscriptions: Subscription[];
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>;
  // The caller's own computeSavingsRecommendations(subscriptions) output —
  // never recomputed here, so a duplicate/overlap finding can't drift
  // between what /savings shows and what the notification center surfaces
  // for the same underlying fact.
  savingsRecommendations: SavingsRecommendation[];
  // Required so savingsOpportunityCandidates below can apply the exact same
  // Free/Pro visibility rule /savings itself uses (splitSavingsRecommendationsByPlan)
  // — see that function's own header comment for why a review-tier finding
  // beyond the one free slot must never leak into a notification body
  // either. Engineering requirement: "never send premium-only intelligence
  // to Free clients" applies just as much to this notification center as it
  // does to the page the finding originally came from.
  isPremium: boolean;
  // Watchdog phase: the caller's own getDismissedRecommendationIds(userId)
  // result (dismissed-recommendations.ts) — a real, already-modeled
  // FEEDBACK signal that used to only reach /savings. A recommendation id a
  // user has explicitly dismissed there must not turn right around and
  // page them about the identical fact through the notification center;
  // see duplicateCandidates/savingsOpportunityCandidates below for the
  // filter. Deliberately NOT applied to staleCandidates — see that
  // function's own comment for why reusing the same permanent-dismissal
  // semantics for a recurring, timer-based finding would be a real bug
  // (silently and permanently suppressing a future, genuinely new instance
  // of "still unreviewed"), not a feature.
  dismissedRecommendationIds: Set<string>;
  // ISO date, injectable for deterministic tests — every other date-aware
  // function in this codebase (savings.ts's computeSavingsRecommendations,
  // signals.ts) takes the same kind of parameter for the same reason.
  today?: string;
}

// Watchdog phase: an active subscription is only ever "possibly lapsed"
// (not just "not yet updated today") once its renewal date has been in the
// past for a real margin, not the instant it technically ticks over —
// avoids a false positive from ordinary timezone skew between the server's
// UTC "today" and the user's own clock.
const LAPSED_RENEWAL_GRACE_DAYS = 3;

// Review-tier savings findings (functional overlap, small-subscription
// clusters) below "medium" priority are real but weak — surfacing every
// "worth a look" review-tier item as its own notification would make the
// center noisy for exactly the accounts with the most subscriptions. Only
// medium/high-priority findings (getSavingsPriority) get a notification;
// everything computeSavingsRecommendations found is still fully visible on
// /savings regardless of this filter.
function isNotifiable(recommendation: SavingsRecommendation): boolean {
  const priority = getSavingsPriority(recommendation);
  return priority === "high" || priority === "medium";
}

function todayIso(input: GenerateNotificationsInput): string {
  return input.today ?? new Date().toISOString().slice(0, 10);
}

// Watchdog phase: plain "renews in N days" is deliberately NOT a
// notification type at all any more — an ordinary upcoming renewal belongs
// to the renewal calendar, the dashboard's own renewal forecast, and the
// weekly digest, all of which already show it. A notification is supposed
// to be an interrupt; a fact that's true for nearly every active
// subscription nearly every week is the definition of noise at normal
// portfolio size, not intelligence (this was flagged directly: the old
// version of this function notified once per subscription per renewal
// event, unconditionally). What IS still worth an interrupt is the
// opposite case: a renewal date that's already passed with nothing
// updating it — a real signal something may have lapsed, not a routine
// heads-up.
//
// daysUntilRenewal (filters.ts) always reads the real wall-clock "today",
// same as every other caller of it in this codebase (renewal-reminders.ts
// included) — it has no injectable date parameter, so this function's own
// tests control "now" via vi.useFakeTimers() rather than a passed-in date,
// unlike this file's other generators which take todayIso from `input`.
function lapsedRenewalCandidates(input: GenerateNotificationsInput): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];
  for (const s of input.subscriptions) {
    if (s.status !== "active") continue;
    const days = daysUntilRenewal(s);
    if (days > -LAPSED_RENEWAL_GRACE_DAYS) continue; // not overdue by a real margin yet
    const daysOverdue = -days;
    // Bucketed for the same reason staleCandidates below buckets
    // daysSinceReviewed: a dedupeKey keyed to the exact day count would
    // either spam (new "row" every single day) or, keyed to the renewal
    // date alone, go silent forever after the first notification for a
    // subscription that just never gets its date updated. 30-day windows
    // give at most one fresh notification per month of continued neglect.
    const bucket = Math.floor((daysOverdue - LAPSED_RENEWAL_GRACE_DAYS) / 30);
    candidates.push({
      type: "renewal_lapsed",
      title: `${s.name}'s renewal date has passed`,
      body: `Was due ${s.nextRenewalDate} (${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago). Still active, or should this be marked canceled?`,
      severity: "warning",
      impactCents: s.amountCents,
      currency: s.currency,
      subscriptionId: s.id,
      actionHref: `/subscriptions/${s.id}`,
      // Tied to the exact renewal date, same "one row per renewal event"
      // identity renewal_reminders' own schema comment documents — if the
      // user updates nextRenewalDate (or it's still the same stale date a
      // month later), this naturally produces a fresh dedupeKey worth a
      // fresh notification rather than staying silent forever after the
      // first one.
      dedupeKey: `renewal_lapsed:${s.id}:${s.nextRenewalDate}:${bucket}`,
    });
  }
  return candidates;
}

// Deliberately does NOT consult dismissedRecommendationIds, unlike
// duplicateCandidates/savingsOpportunityCandidates below — see
// GenerateNotificationsInput's own comment on dismissedRecommendationIds
// for why: savings.ts's "stale" recommendation id (`stale-${subscriptionId}`)
// never changes for a given subscription, but staleness itself is a
// recurring, timer-based fact (bucketed by daysSinceReviewed, reset by a
// real review). Filtering by a permanent dismissal id here would silently
// and permanently suppress every future month's worth of "still
// unreviewed" for that subscription — exactly the "permanently hiding
// genuinely new evidence" failure mode this phase was told to avoid. The
// bucketed dedupeKey below already provides the right "don't nag daily"
// behavior on its own.
function staleCandidates(input: GenerateNotificationsInput): NotificationCandidate[] {
  const today = todayIso(input);
  const nowMs = new Date(`${today}T00:00:00Z`).getTime();
  return findStaleSubscriptions(input.subscriptions, nowMs).map(({ subscription, daysSinceReviewed, everReviewed }) => {
    // Bucketed, not the exact day count: without this, a subscription that
    // stays unreviewed keeps the *same* days-since figure baked into its
    // dedupeKey only for one day, then generates a brand-new "row" every
    // single day forever (a new day count is a new dedupeKey). Bucketing
    // into 30-day windows past the threshold means at most one fresh
    // notification per subscription per month of continued neglect, not one
    // per day — the "don't spam" requirement, satisfied by construction
    // rather than by a separate rate limit.
    const bucket = Math.floor((daysSinceReviewed - STALE_THRESHOLD_DAYS) / 30);
    return {
      type: "stale_subscription" as const,
      title: `Still using ${subscription.name}?`,
      body: everReviewed
        ? `You haven't reviewed this in ${daysSinceReviewed} days.`
        : `Added ${daysSinceReviewed} days ago and never reviewed.`,
      severity: "info" as const,
      impactCents: subscription.amountCents,
      currency: subscription.currency,
      subscriptionId: subscription.id,
      actionHref: `/subscriptions/${subscription.id}`,
      dedupeKey: `stale_subscription:${subscription.id}:${bucket}`,
    };
  });
}

function priceIncreaseCandidates(input: GenerateNotificationsInput): NotificationCandidate[] {
  return computePortfolioPriceChanges(input.subscriptions, input.priceHistoryBySubscriptionId).map(({ subscription, change }) => {
    // Watchdog phase: cross-reference lastReviewedAt (schema.ts — set only
    // by a real GET of this exact subscription's detail page, never a
    // system write) against the change's own observedAtIso. If the user
    // looked at this subscription's page AFTER the price actually changed,
    // they've had a real chance to see PriceHistoryNote's own account of
    // it there — inserting this notification already-read means it still
    // exists as a truthful record (visible in full /notifications history)
    // without nagging about something they've plausibly already seen. A
    // review that happened BEFORE the change (or no review at all) leaves
    // it unread, same as before.
    const alreadyReviewed =
      subscription.lastReviewedAt !== null && subscription.lastReviewedAt.getTime() >= new Date(`${change.observedAtIso}T00:00:00Z`).getTime();
    return {
      type: "price_increase" as const,
      title: `${subscription.name} increased from ${formatCents(change.fromCents, change.currency)} to ${formatCents(change.toCents, change.currency)}`,
      body: `That's ${formatCents(change.annualDeltaCents, change.currency)}/year more, effective ${change.observedAtIso}.`,
      severity: "warning" as const,
      impactCents: change.annualDeltaCents,
      currency: change.currency,
      subscriptionId: subscription.id,
      actionHref: `/subscriptions/${subscription.id}`,
      // Tied to the exact observed change (subscriptionPriceHistory row
      // identity, see schema.ts's own comment) — fires exactly once per real
      // change, never again once a later price change eventually replaces it
      // as "latest".
      dedupeKey: `price_increase:${subscription.id}:${change.observedAtIso}:${change.toCents}`,
      readAt: alreadyReviewed ? subscription.lastReviewedAt : null,
    };
  });
}

function duplicateCandidates(input: GenerateNotificationsInput): NotificationCandidate[] {
  return input.savingsRecommendations
    .filter((r) => r.type === "duplicate" && !input.dismissedRecommendationIds.has(r.id))
    .map((r) => ({
      type: "duplicate_subscription" as const,
      title: r.title,
      body: `${formatCents(r.monthlySavingsCents, r.currency)}/mo if you cancel the redundant one.`,
      severity: "warning" as const,
      impactCents: r.monthlySavingsCents,
      currency: r.currency,
      subscriptionId: r.targetSubscriptionId,
      actionHref: `/subscriptions/${r.targetSubscriptionId}`,
      dedupeKey: `duplicate_subscription:${r.id}`,
    }));
}

// Functional-overlap and small-subscription-cluster findings only — "stale"
// recommendations (savings.ts also produces these, reusing the exact same
// findStaleSubscriptions this file's own staleCandidates above calls) are
// deliberately excluded here so a single stale subscription never produces
// two notifications for the same underlying fact, and "duplicate" findings
// are handled by duplicateCandidates above instead (always free — see that
// function's own reasoning).
//
// Filtered through splitSavingsRecommendationsByPlan BEFORE this file's own
// isNotifiable priority filter — scoped to just this type subset (not the
// full recommendations list, which would also mix in "duplicate"/"stale"
// when deciding which one review-tier item is the free-visible slot) so
// "which one item is free" here matches exactly what a free caller would
// see if they filtered /savings down to only overlap/cluster findings
// themselves. A free account with several medium/high-priority review-tier
// findings must see at most one show up here as a notification, the same
// single slot /savings itself grants — never every one of them in full
// detail just because the notification center is a different surface.
function savingsOpportunityCandidates(input: GenerateNotificationsInput): NotificationCandidate[] {
  const overlapAndClusterOnly = input.savingsRecommendations.filter(
    (r) => r.type === "functional_overlap" || r.type === "small_subscriptions",
  );
  const { visible } = splitSavingsRecommendationsByPlan(overlapAndClusterOnly, input.isPremium);
  return visible
    .filter((r) => isNotifiable(r) && !input.dismissedRecommendationIds.has(r.id))
    .map((r) => ({
      type: "savings_opportunity" as const,
      title: r.title,
      body: r.description,
      severity: "info" as const,
      impactCents: r.impactCents,
      currency: r.currency,
      subscriptionId: r.targetSubscriptionId,
      actionHref: "/savings",
      dedupeKey: `savings_opportunity:${r.id}`,
    }));
}

// Unusual-charge candidates are deliberately NOT generated here — unlike
// every other type above, "unusual" needs a specific, live detection event
// to judge against (detection.ts's own amountVariancePct/confidenceSignals,
// computed fresh per analyzed batch), not a fact re-derivable from
// subscriptions/priceHistory/savingsRecommendations alone. See
// buildUnusualChargeCandidate below, called directly from the automatic
// sync cron (lib/imports/connected-account-sync-job.ts) at the one moment
// that signal actually exists — never from the interactive Import Center
// confirm flow, whose client payload doesn't carry amountVariancePct
// through today (a real, disclosed scope boundary, not an oversight: wiring
// it into the interactive flow needs a payload-contract change this phase
// doesn't make).

export function generateNotificationCandidates(input: GenerateNotificationsInput): NotificationCandidate[] {
  return [
    ...priceIncreaseCandidates(input),
    ...lapsedRenewalCandidates(input),
    ...duplicateCandidates(input),
    ...staleCandidates(input),
    ...savingsOpportunityCandidates(input),
  ];
}

// The variance bar detection.ts's own CONSISTENT_AMOUNT_MAX_VARIANCE_PCT
// (0.15) already uses to decide "irregular_amount" vs "consistent_amount"
// for a detected cluster — reused verbatim here rather than a second,
// invented threshold. Only fires when the cluster matched an EXISTING
// active subscription (this is "a subscription you already track is
// charging unpredictably," not "a new possible subscription exists" — the
// latter stays inside the ordinary, human-reviewed Import Center flow,
// same as every other new-subscription detection).
const UNUSUAL_CHARGE_VARIANCE_THRESHOLD_PCT = 0.15;

export function buildUnusualChargeCandidate(
  subscription: Subscription,
  detected: { amountCents: number; amountVariancePct: number; transactions: { date: string }[] },
): NotificationCandidate | null {
  if (detected.amountVariancePct < UNUSUAL_CHARGE_VARIANCE_THRESHOLD_PCT) return null;
  const latestDate = [...detected.transactions].map((t) => t.date).sort().at(-1);
  if (!latestDate) return null;
  return {
    type: "unusual_charge",
    title: `${subscription.name}'s charges look irregular`,
    body: `Recent amounts for this subscription vary by more than ${Math.round(UNUSUAL_CHARGE_VARIANCE_THRESHOLD_PCT * 100)}% from one charge to the next — worth a look at your bank activity.`,
    severity: "warning",
    impactCents: detected.amountCents,
    currency: subscription.currency,
    subscriptionId: subscription.id,
    actionHref: `/subscriptions/${subscription.id}`,
    // Tied to the specific latest transaction date this observation came
    // from — a sync that keeps seeing the SAME irregular pattern (no new
    // transaction date) never re-notifies; a genuinely new irregular charge
    // (a new date) does, the same "new evidence still notifies" posture
    // price_increase's own dedupeKey already follows.
    dedupeKey: `unusual_charge:${subscription.id}:${latestDate}`,
  };
}

// Council-review fix (silent-failure path #2): a genuine price-change
// proposal detected during automatic sync that does NOT meet the
// confidence: "high" bar connected-account-sync-job.ts requires to
// auto-apply — previously computed and then discarded with no record at
// all (a real DETECTION -> INSIGHT dead end, not a UX nitpick: a clean
// medium-confidence match is exactly the realistic case that clears
// neither the auto-apply gate nor buildUnusualChargeCandidate's variance
// bar above, since a clean price step has LOW variance by construction).
//
// Deliberately never writes to subscriptions/subscriptionPriceHistory —
// this is a reviewable finding only, same "detection without a
// human-confirmed write" boundary the Import Center's own review step
// already established for every other unconfirmed proposal. The user acts
// on it the same way they'd act on any other detail-page finding: by
// looking at the real numbers and, if they agree, editing the amount
// themselves via the subscription's own existing edit form — no new
// one-click "confirm" affordance is added here.
//
// dedupeKey is tied to the exact detected value (not a date or a bucket):
// the same medium-confidence proposal, re-detected on every subsequent
// daily sync while nothing about it changes, produces exactly one
// notification, not one per day. If the detected amount changes again —
// genuinely new evidence — that's a new dedupeKey and a new notification,
// the same posture every other candidate in this file follows.
export function buildPriceChangeReviewCandidate(
  subscription: Subscription,
  proposal: PriceChangeProposal,
): NotificationCandidate {
  const direction = proposal.percentChange > 0 ? "up" : "down";
  return {
    type: "price_change_review",
    title: `${subscription.name} may have changed to ${formatCents(proposal.detectedAmountCents, proposal.currency)}`,
    body: `Your bank shows a different amount than what's on record (${formatCents(subscription.amountCents, subscription.currency)}) — looks like it moved ${direction}, but not confident enough to update automatically. Worth a look.`,
    severity: "info",
    // Math.abs: annualDeltaCents is signed (a decrease is negative) but
    // impactCents has a non-negative DB check constraint (schema.ts) — the
    // sign is already carried by `direction` in the copy above, not lost.
    impactCents: Math.abs(proposal.annualDeltaCents),
    currency: proposal.currency,
    subscriptionId: subscription.id,
    actionHref: `/subscriptions/${subscription.id}`,
    dedupeKey: `price_change_review:${subscription.id}:${proposal.detectedAmountCents}:${proposal.detectedBillingCycle}`,
  };
}

// Council-review fix (silent-failure path #1): a bank/email connection
// that failed to sync with reconnect_required or decrypt_error
// (sync-transactions.ts) — previously logged server-side only, so a dead
// connection silently stopped protecting the user with no signal anywhere
// in the product that automatic detection had quietly paused for that
// account. provider_error (a transient API/network failure) is
// deliberately NOT covered by this builder — that's retried automatically
// on the next scheduled run and isn't something reconnecting would fix, so
// surfacing it as an actionable "reconnect" notification would be
// misleading.
//
// Bucketed by a real time window (not a permanent one-shot, and not a
// daily re-notify either): the sync cron runs daily and a persistently
// broken connection is retried every run, so without bucketing this would
// either never re-remind (a one-shot dedupeKey) or spam once a day
// (a dedupeKey with no time component at all). Seven days matches this
// module's own staleCandidates/lapsedRenewalCandidates precedent for "a
// real, ongoing problem re-surfaces periodically, not constantly."
const CONNECTION_ISSUE_REBUCKET_DAYS = 7;

export type ConnectionProvider = "plaid" | "truelayer" | "gmail";
export type ConnectionIssueReason = "reconnect_required" | "decrypt_error";

const CONNECTION_PROVIDER_LABEL: Record<ConnectionProvider, string> = {
  plaid: "Plaid",
  truelayer: "TrueLayer",
  gmail: "Gmail",
};

const CONNECTION_ISSUE_REASON_COPY: Record<ConnectionIssueReason, string> = {
  reconnect_required: "expired",
  decrypt_error: "can no longer be read",
};

export function buildConnectionIssueCandidate(params: {
  connectionId: string;
  provider: ConnectionProvider;
  reason: ConnectionIssueReason;
  now?: Date;
}): NotificationCandidate {
  const now = params.now ?? new Date();
  const bucket = Math.floor(now.getTime() / (CONNECTION_ISSUE_REBUCKET_DAYS * 86_400_000));
  const providerLabel = CONNECTION_PROVIDER_LABEL[params.provider];
  return {
    type: "connection_issue",
    title: `Your ${providerLabel} connection needs attention`,
    body: `SubSentry couldn't sync your ${providerLabel} account — the connection ${CONNECTION_ISSUE_REASON_COPY[params.reason]}. Automatic detection is paused for this account until you reconnect.`,
    severity: "warning",
    impactCents: null,
    currency: null,
    subscriptionId: null,
    actionHref: "/settings",
    dedupeKey: `connection_issue:${params.connectionId}:${bucket}`,
  };
}
