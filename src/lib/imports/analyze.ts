import type { Subscription } from "@/lib/db/schema";
import { rawTransactionSchema } from "./validation";
import { detectRecurringSubscriptions } from "./detection";
import type { ImportParseResult, DetectedSubscription } from "./types";

export interface AnalyzeResult {
  detected: DetectedSubscription[];
  warnings: string[];
  skippedRowCount: number;
}

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
  const validTransactions = [];
  for (const transaction of parseResult.transactions) {
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
