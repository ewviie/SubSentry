import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";

// Phase 2: Apple's manual subscription export is itself CSV/TSV-shaped, so
// this will delegate to the same shared csv-parser.ts machinery as
// csv-bank-provider.ts, just with a different HeaderAliases map (Apple's
// export uses columns like "Subscription", "Renewal Date", "Price" rather
// than a bank statement's "Date"/"Amount"). Stubbed disabled for Phase 1 —
// registered so its source-picker card exists and reads "Coming soon"
// rather than being silently absent, without a real implementation yet.
export const appleImportProvider: ImportProvider = {
  id: "apple",
  label: "Apple Subscriptions",
  description: "Import your Apple subscription export to detect active App Store subscriptions.",
  acceptedFileTypes: [".csv", "text/csv"],
  maxFileSizeBytes: 5 * 1024 * 1024,
  enabled: false,
  validate() {
    return { valid: false, reason: "Apple import is coming soon." };
  },
  async parse(): Promise<ImportParseResult> {
    throw new Error("Apple import is not yet implemented.");
  },
};
