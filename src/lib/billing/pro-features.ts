// Single source of truth for "what Pro actually unlocks and what it
// costs" — the homepage pricing section, Settings → Plan & Billing, and
// the login page's compact Pro teaser all read from this instead of each
// keeping their own copy of the same list, which is exactly how the
// Settings/pricing-section lists drifted out of sync before (Settings was
// missing "Optimization recommendations" until that was caught and fixed
// separately). "Everything in Free" is deliberately not included here: it
// only makes sense in pricing-section.tsx's own side-by-side Free/Pro
// comparison, not in a single-tier teaser like Settings' or login's.
export const PRO_MONTHLY_PRICE = "£4.99";

export const PRO_FEATURES = [
  "Unlimited active subscriptions",
  "Automatic daily watchdog sync for connected accounts",
  "Full Health Score across all 5 factors",
  "Every savings opportunity",
  "Optimization recommendations",
  "AI quick-add — 40/day",
  "Priority support",
];
