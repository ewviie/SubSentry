import type { Import } from "@/lib/db/schema";
import { IMPORT_SOURCE_LABELS, IMPORT_STATUS_BADGE_VARIANTS, IMPORT_STATUS_LABELS } from "./labels";

// Service layer between the repository (queries.ts's listImports/getImport)
// and the UI: turns a raw `imports` row into display-ready values, so
// components never touch enum keys or raw Date objects directly. Pure and
// synchronous — no I/O — matching the split already established by
// src/lib/subscriptions/insights.ts (pure computation) sitting between
// queries.ts (repository) and the pages that render it.
export interface ImportHistorySummary {
  id: string;
  sourceLabel: string;
  statusLabel: string;
  statusVariant: "default" | "destructive" | "secondary";
  // The audit table deliberately doesn't store a raw per-file transaction
  // count (see schema.ts's comment on the `imports` table) — detectedCount
  // is the closest available figure: how many recurring-subscription
  // candidates were identified from the processed file.
  detectedCount: number;
  importedCount: number;
  ignoredCount: number;
  hasErrors: boolean;
  createdAtLabel: string;
  createdAtIso: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function summarizeImport(record: Import): ImportHistorySummary {
  return {
    id: record.id,
    sourceLabel: IMPORT_SOURCE_LABELS[record.source],
    statusLabel: IMPORT_STATUS_LABELS[record.status],
    statusVariant: IMPORT_STATUS_BADGE_VARIANTS[record.status],
    detectedCount: record.detectedCount,
    importedCount: record.importedCount,
    ignoredCount: record.ignoredCount,
    hasErrors: record.errors.length > 0,
    createdAtLabel: dateTimeFormatter.format(record.createdAt),
    createdAtIso: record.createdAt.toISOString(),
  };
}

export function summarizeImports(records: Import[]): ImportHistorySummary[] {
  return records.map(summarizeImport);
}
