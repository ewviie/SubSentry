import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";

// Phase 2: Google Play's export is also CSV-shaped (columns like "Product",
// "Order Date", "Charged Amount"), so this will delegate to the shared
// csv-parser.ts machinery, same as apple-provider.ts. Stubbed disabled for
// Phase 1 — see apple-provider.ts for the reasoning.
export const googlePlayImportProvider: ImportProvider = {
  id: "google_play",
  label: "Google Play",
  description: "Import exported Google Play subscription information.",
  acceptedFileTypes: [".csv", "text/csv"],
  maxFileSizeBytes: 5 * 1024 * 1024,
  enabled: false,
  validate() {
    return { valid: false, reason: "Google Play import is coming soon." };
  },
  async parse(): Promise<ImportParseResult> {
    throw new Error("Google Play import is not yet implemented.");
  },
};
