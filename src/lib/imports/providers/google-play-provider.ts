import { parseCsvRows, parseCsvTransactions, normalizeHeaders, type HeaderAliases } from "../csv-parser";
import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";

// Google Play's order-history export (Play Console "Order history" export,
// or a Google Takeout purchase-history CSV) is also CSV-shaped — same
// shared csv-parser.ts machinery as csv-bank-provider.ts and
// apple-provider.ts, just a different HeaderAliases map. No separate
// detection logic: parse() output flows into the same
// detectRecurringSubscriptions() every other source uses.
const GOOGLE_PLAY_EXPORT_ALIASES: HeaderAliases = {
  date: ["date", "order date", "transaction date", "creation time", "purchase date"],
  description: ["product", "product title", "item", "description", "product name"],
  merchant: ["product", "product title", "item", "description", "product name"],
  amount: ["amount", "charged amount", "price", "total", "total price"],
  // Google Play's export is a flat list of charges — no separate
  // debit/credit columns and no direction-label column exist in the real
  // export formats.
  debit: [],
  credit: [],
  direction: [],
  reference: ["order id", "orderid", "order number"],
  currency: ["currency", "currency of sale"],
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function validate(fileText: string): { valid: true } | { valid: false; reason: string } {
  const rows = parseCsvRows(fileText);
  if (rows.length === 0) return { valid: false, reason: "File is empty." };
  const headerMap = normalizeHeaders(rows[0], GOOGLE_PLAY_EXPORT_ALIASES);
  if (headerMap.date === null) {
    return { valid: false, reason: "No recognizable date column found. Expected a column like \"Order Date\"." };
  }
  if (headerMap.amount === null) {
    return { valid: false, reason: "No recognizable amount column found. Expected a column like \"Amount\"." };
  }
  if (headerMap.description === null && headerMap.merchant === null) {
    return {
      valid: false,
      reason: "No recognizable product column found. Expected a column like \"Product\".",
    };
  }
  return { valid: true };
}

async function parse(fileText: string): Promise<ImportParseResult> {
  // defaultDirection: "debit" — every row in a Google Play order-history
  // export is a charge; there's no sign or debit/credit column to infer it
  // from, unlike a bank statement.
  return parseCsvTransactions(fileText, {
    aliases: GOOGLE_PLAY_EXPORT_ALIASES,
    defaultCurrency: "usd",
    defaultDirection: "debit",
  });
}

export const googlePlayImportProvider: ImportProvider = {
  id: "google_play",
  label: "Google Play",
  description: "Import exported Google Play subscription information.",
  acceptedFileTypes: [".csv", "text/csv"],
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  enabled: true,
  validate,
  parse,
};
