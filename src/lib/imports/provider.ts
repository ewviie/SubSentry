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
// API, schema — only a new provider file plus a new entry in
// IMPORT_SOURCE_IDS and a new `source` enum value.
//
// IMPORT_SOURCE_IDS is the runtime source of truth; ImportSourceId is
// derived from it (not the other way around) so call sites that need the
// list of valid ids at runtime — e.g. the analyze route's zod schema —
// import this array instead of hand-duplicating the literal union, the same
// SUBSCRIPTION_SOURCES/SubscriptionSource pattern used for the DB-level
// source enum in src/lib/subscriptions/source.ts.
export const IMPORT_SOURCE_IDS = ["csv_bank", "apple", "google_play", "plaid", "truelayer", "gmail"] as const;
export type ImportSourceId = (typeof IMPORT_SOURCE_IDS)[number];

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

  // Optional: the extension point for live-API providers (Plaid, TrueLayer,
  // Stripe Financial Connections, etc.) that don't have a "file" at all —
  // they fetch transactions from a live API using a stored per-user access
  // token instead. A provider that implements this still declares
  // validate()/parse() (returning an explicit "not applicable" — see
  // plaid-provider.ts) so it satisfies the interface uniformly; the caller
  // (a dedicated route, not the file-upload analyze route) checks for this
  // method's presence to decide which orchestration path applies. Detection,
  // the review UI, and the confirm API are unchanged either way — both paths
  // converge on the same RawTransaction[]/ImportParseResult shape.
  fetchTransactions?(accessToken: string): Promise<ImportParseResult>;
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
