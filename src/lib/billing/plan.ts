import type { User } from "@/lib/db/schema";

// ─── Beta entitlement gate ─────────────────────────────────────────────────
// Single choke point for "is paid access unlocked." During the free beta
// this always returns true, so every plan check below behaves as if every
// user is on Pro — no other file should read `user.plan` to decide feature
// access. Flip BETA_ALL_ACCESS to false (and this reverts to real
// plan-based gating everywhere) when monetization restarts. The
// plan column, webhook, and Stripe wiring are untouched — this only
// short-circuits what they unlock.
const BETA_ALL_ACCESS = true;

export function hasPaidAccess(plan: User["plan"]): boolean {
  return BETA_ALL_ACCESS || plan === "pro";
}

// For UI copy that needs to distinguish "actually on Pro" from "unlocked
// because of the beta" — e.g. showing a "Beta — full access" badge instead
// of falsely claiming a free-plan user is on Pro.
export function isBetaAllAccess(): boolean {
  return BETA_ALL_ACCESS;
}

// Free plan is deliberately generous enough to be useful (most people track
// well under this many subscriptions) while still giving Pro a reason to
// exist. Pro has no product-facing cap — see MAX_ACTIVE_SUBSCRIPTIONS below
// for the separate defensive backstop that applies regardless of plan.
export const FREE_PLAN_SUBSCRIPTION_LIMIT = 5;

export function hasReachedSubscriptionLimit(plan: User["plan"], activeCount: number): boolean {
  return !hasPaidAccess(plan) && activeCount >= FREE_PLAN_SUBSCRIPTION_LIMIT;
}

// A defensive ceiling, not a product limit — no legitimate user tracks
// anywhere near this many subscriptions. computeInsights() (see
// lib/subscriptions/insights.ts) runs an O(n²) duplicate-name comparison
// over a user's active subscriptions on every dashboard load; this bounds
// that cost against pathological or scripted growth without touching the
// "Pro is unlimited" promise for any real user.
export const MAX_ACTIVE_SUBSCRIPTIONS = 2000;

// Appending client_reference_id to a Stripe Payment Link URL carries it
// through to the resulting Checkout Session with no dashboard configuration
// needed — that's how the webhook maps a completed checkout back to a user
// without ever creating the Checkout Session via the Stripe API ourselves.
export function getUpgradeUrl(userId: string): string | null {
  if (BETA_ALL_ACCESS) return null;
  const paymentLink = process.env.STRIPE_PAYMENT_LINK;
  if (!paymentLink) return null;

  const url = new URL(paymentLink);
  url.searchParams.set("client_reference_id", userId);
  return url.toString();
}

// Unlike getUpgradeUrl above (a Payment Link the browser can hit directly),
// opening the Billing Portal requires an authenticated server-to-server
// Stripe API call to mint a one-time session URL — see api/billing/portal.
// STRIPE_SECRET_KEY is a distinct credential from STRIPE_WEBHOOK_SECRET and
// isn't required for the rest of this app to function, so its absence is a
// normal "not configured yet" state, not an error.
export function isBillingPortalConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
