import type { SubscriptionSource } from "./source";

// Display labels for the analytics dashboard's "spend by source" breakdown
// — a superset of src/lib/imports/labels.ts's IMPORT_SOURCE_LABELS (which
// only covers the four import-specific values) since this chart also needs
// to label "manual" and "ai_parsed" entries.
export const SOURCE_ANALYTICS_LABELS: Record<SubscriptionSource, string> = {
  manual: "Added manually",
  ai_parsed: "Quick Add (AI)",
  csv_import: "Bank CSV",
  apple_import: "Apple Subscriptions",
  google_play_import: "Google Play",
  plaid_import: "Bank (Plaid)",
  truelayer_import: "Bank (TrueLayer)",
  gmail_import: "Google (Gmail)",
};

// A fixed hue per source, distinct from category-colors.ts's assignment
// (a different dimension entirely) — "ai_parsed" reuses the existing `ai`
// token already tied to AI features elsewhere in the app (Quick Add,
// landing page); the rest draw from the same chart-1..6 set.
export const SOURCE_BAR_CLASSES: Record<SubscriptionSource, string> = {
  manual: "bg-chart-5",
  ai_parsed: "bg-ai",
  csv_import: "bg-chart-2",
  apple_import: "bg-chart-3",
  google_play_import: "bg-chart-4",
  plaid_import: "bg-chart-1",
  truelayer_import: "bg-chart-6",
  // Reuses chart-2's hue rather than introducing a 7th chart color token —
  // csv_import (Bank CSV) and gmail_import are unlikely to appear in the
  // same account's breakdown often enough that sharing a color reads as
  // ambiguous in practice, and adding an 8th token is a design-system
  // change out of scope here.
  gmail_import: "bg-chart-2",
};
