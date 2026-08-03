import type { ImportParseResult } from "./types";

// Mirrors src/lib/ai/provider.ts's AIProvider shape: a small interface, one
// implementation per source, a registry callers never need to branch on.
//
// A provider's only job is turning raw input into transactions — it never
// touches the DB, never sees a user, never decides what's a subscription
// (that's the detection engine, downstream, in detection.ts). This is
// deliberate: it's the extension point for the live-API providers explicitly
// out of scope for this milestone (Plaid, TrueLayer, Stripe Financial
// Connections, PayPal, Revolut, Monzo, Chase, Capital One, generic Open
// Banking). Each of those implements this same interface, but is invoked
// from a different orchestration path (an OAuth callback, not the
// file-upload route) that fetches transactions from a live API and adapts
// them into the same ImportParseResult shape instead of parsing file text.
// Zero changes needed anywhere downstream — detection, review UI, confirm
// API, schema — only a new provider file plus a new ImportSourceId and
// `source` enum value.
export type ImportSourceId = "csv_bank" | "apple" | "google_play";

export interface ImportProvider {
  readonly id: ImportSourceId;
  readonly label: string;
  readonly description: string;
  readonly acceptedFileTypes: string[];
  readonly maxFileSizeBytes: number;
  readonly enabled: boolean;

  // Cheap, fast-feedback check of file shape/headers before the heavier
  // parse — lets the UI's "Validate" step fail fast without running full
  // detection over a file that was never going to work.
  validate(fileText: string): { valid: true } | { valid: false; reason: string };

  // Pure parse: file text in, normalized rows out. Never throws on
  // malformed *rows* (collects them into warnings/skippedRowCount instead)
  // — only on structurally unreadable input.
  parse(fileText: string): Promise<ImportParseResult>;
}

const registry = new Map<ImportSourceId, ImportProvider>();

export function registerImportProvider(provider: ImportProvider): void {
  registry.set(provider.id, provider);
}

export function getImportProvider(id: ImportSourceId): ImportProvider {
  const provider = registry.get(id);
  if (!provider) throw new Error(`Unknown import source: ${id}`);
  return provider;
}

export function listImportProviders(): ImportProvider[] {
  return Array.from(registry.values());
}
