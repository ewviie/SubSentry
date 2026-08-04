import type { Import } from "@/lib/db/schema";

export const IMPORT_SOURCE_LABELS: Record<Import["source"], string> = {
  csv_import: "Bank CSV",
  apple_import: "Apple Subscriptions",
  google_play_import: "Google Play",
  plaid_import: "Bank (Plaid)",
  truelayer_import: "Bank (TrueLayer)",
};

export const IMPORT_STATUS_LABELS: Record<Import["status"], string> = {
  completed: "Completed",
  failed: "Failed",
  // Not currently written by any code path (the confirm route only ever
  // writes "completed"/"failed" — see queries.ts's createImportRecord call
  // sites) — kept here for schema completeness so the label map stays
  // exhaustive if a future "abandoned mid-review" state is ever persisted.
  reviewed: "In review",
};

export const IMPORT_STATUS_BADGE_VARIANTS: Record<Import["status"], "default" | "destructive" | "secondary"> = {
  completed: "default",
  failed: "destructive",
  reviewed: "secondary",
};
