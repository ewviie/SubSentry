import { parseCsvRows, parseCsvTransactions, normalizeHeaders, type HeaderAliases } from "../csv-parser";
import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";

// Apple's manual subscription/purchase-history export (from "Request a copy
// of your data" or a Reports > Purchase History export) is itself
// CSV-shaped, so this delegates to the exact same shared csv-parser.ts
// machinery csv-bank-provider.ts uses — a different HeaderAliases map, same
// tokenizer/header-normalization/row-parsing engine. No separate detection
// logic: whatever comes out of parse() below flows into the same
// detectRecurringSubscriptions() every other source uses.
const APPLE_EXPORT_ALIASES: HeaderAliases = {
  date: ["date", "purchase date", "renewal date", "transaction date", "billing date"],
  description: ["subscription", "title", "item", "app name", "product", "product name"],
  merchant: ["subscription", "title", "item", "app name", "product", "product name"],
  amount: ["price", "amount", "charged amount", "item price", "you paid"],
  // Apple's export is a flat list of charges — no separate debit/credit
  // columns and no direction-label column exist in the real export formats.
  debit: [],
  credit: [],
  direction: [],
  reference: ["order id", "transaction id", "document number"],
  currency: ["currency", "currency code"],
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function validate(fileText: string): { valid: true } | { valid: false; reason: string } {
  const rows = parseCsvRows(fileText);
  if (rows.length === 0) return { valid: false, reason: "File is empty." };
  const headerMap = normalizeHeaders(rows[0], APPLE_EXPORT_ALIASES);
  if (headerMap.date === null) {
    return { valid: false, reason: "No recognizable date column found. Expected a column like \"Purchase Date\"." };
  }
  if (headerMap.amount === null) {
    return { valid: false, reason: "No recognizable amount column found. Expected a column like \"Price\"." };
  }
  if (headerMap.description === null && headerMap.merchant === null) {
    return {
      valid: false,
      reason: "No recognizable subscription/item column found. Expected a column like \"Subscription\".",
    };
  }
  return { valid: true };
}

async function parse(fileText: string): Promise<ImportParseResult> {
  // defaultDirection: "debit" — every row in an Apple purchase-history
  // export is a charge (money leaving the account); there's no sign or
  // debit/credit column to infer it from, unlike a bank statement.
  return parseCsvTransactions(fileText, {
    aliases: APPLE_EXPORT_ALIASES,
    defaultCurrency: "usd",
    defaultDirection: "debit",
  });
}

export const appleImportProvider: ImportProvider = {
  id: "apple",
  label: "Apple Subscriptions",
  description: "Import your Apple subscription export to detect active App Store subscriptions.",
  acceptedFileTypes: [".csv", "text/csv"],
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  enabled: true,
  validate,
  parse,
};
