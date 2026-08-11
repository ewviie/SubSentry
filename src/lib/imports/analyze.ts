import type { Subscription } from "@/lib/db/schema";
import { rawTransactionSchema } from "./validation";
import { detectRecurringSubscriptions } from "./detection";
import type { ImportParseResult, DetectedSubscription } from "./types";

export interface AnalyzeResult {
  detected: DetectedSubscription[];
  warnings: string[];
  skippedRowCount: number;
}

// Bounds how many rows ever reach detection, regardless of source. Only
// byte size was capped before this (5-10MB per upload, provider
// maxFileSizeBytes) — a file of many short rows could still carry a very
// large row count, each paying detectRecurringSubscriptions' per-row
// normalizeMerchant() cost (a ~50-entry substring/levenshtein scan)
// synchronously in the request path. 5,000 is generous relative to any real
// bank/card export (LOOKBACK_DAYS in plaid-provider.ts is 365 days, and even
// a very active account rarely clears a few hundred transactions a year) —
// this is a ceiling against a pathological input, not a limit a legitimate
// import is likely to ever hit. Truncated, not rejected outright: a
// genuinely large-but-legitimate file still gets a usable partial result
// (with a clear warning) rather than an all-or-nothing failure.
const MAX_TRANSACTIONS_PER_IMPORT = 5000;

// The second validation gate + detection call shared by every provider's
// entry route — the file-upload analyze route (/api/imports/analyze) and
// each live-API provider's sync route (/api/imports/plaid/sync,
// /api/imports/truelayer/sync). Pulled out once both needed the exact same
// "validate every parsed row, then hand the survivors to detection" logic,
// rather than the sync routes re-deriving it.
export function analyzeParsedTransactions(
  parseResult: ImportParseResult,
  existingSubscriptions: Subscription[],
): AnalyzeResult {
  const warnings = [...parseResult.warnings];
  let skippedRowCount = parseResult.skippedRowCount;

  const overflow = Math.max(0, parseResult.transactions.length - MAX_TRANSACTIONS_PER_IMPORT);
  const rows = overflow > 0 ? parseResult.transactions.slice(0, MAX_TRANSACTIONS_PER_IMPORT) : parseResult.transactions;
  if (overflow > 0) {
    skippedRowCount += overflow;
    warnings.push(
      `This import had more than ${MAX_TRANSACTIONS_PER_IMPORT} rows; only the first ${MAX_TRANSACTIONS_PER_IMPORT} were processed.`,
    );
  }

  const validTransactions = [];
  for (const transaction of rows) {
    const result = rawTransactionSchema.safeParse(transaction);
    if (result.success) {
      validTransactions.push(result.data);
    } else {
      skippedRowCount += 1;
      warnings.push("A row failed validation and was skipped.");
    }
  }

  const detected = detectRecurringSubscriptions(validTransactions, existingSubscriptions);
  return { detected, warnings, skippedRowCount };
}
