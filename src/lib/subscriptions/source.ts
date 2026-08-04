// Single source of truth for subscription provenance, imported by the schema
// (TS-only enum sugar, no DB constraint), the repository layer, and every API
// route that accepts or restricts a `source` value. Widened here — rather
// than hand-duplicating the literal array a third/fourth/fifth time — because
// the Import Center touches this enum in more places than the two that
// existed before it (schema.ts, api/subscriptions/route.ts), and hand-syncing
// five copies is a real correctness risk the previous two-copy duplication
// never hit.
export const SUBSCRIPTION_SOURCES = [
  "manual",
  "ai_parsed",
  "csv_import",
  "apple_import",
  "google_play_import",
  "plaid_import",
  "truelayer_import",
] as const;

export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];
