import { parseCsvRows, parseCsvTransactions, normalizeHeaders, type HeaderAliases } from "../csv-parser";
import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";

// Column-order-independent: any bank export with a recognizable date column
// and a recognizable amount/debit/credit column and a recognizable
// merchant/description column will parse, regardless of column order or
// exact header wording, via this alias list.
const BANK_CSV_ALIASES: HeaderAliases = {
  date: ["date", "transaction date", "posted date", "value date", "trans date"],
  description: ["description", "narrative", "details", "transaction details"],
  merchant: ["merchant", "payee", "name"],
  amount: ["amount", "value", "transaction amount", "amount (usd)"],
  debit: ["debit", "debit amount", "withdrawal", "money out", "paid out"],
  credit: ["credit", "credit amount", "deposit", "money in", "paid in"],
  direction: ["type", "debit/credit", "transaction type", "dr/cr"],
  reference: ["reference", "ref", "memo"],
  currency: ["currency", "ccy"],
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function validate(fileText: string): { valid: true } | { valid: false; reason: string } {
  const rows = parseCsvRows(fileText);
  if (rows.length === 0) return { valid: false, reason: "File is empty." };
  const headerMap = normalizeHeaders(rows[0], BANK_CSV_ALIASES);
  if (headerMap.date === null) {
    return { valid: false, reason: "No recognizable date column found. Expected a column like \"Date\"." };
  }
  if (headerMap.amount === null && headerMap.debit === null && headerMap.credit === null) {
    return { valid: false, reason: "No recognizable amount column found. Expected a column like \"Amount\"." };
  }
  if (headerMap.description === null && headerMap.merchant === null) {
    return {
      valid: false,
      reason: "No recognizable merchant/description column found. Expected a column like \"Description\".",
    };
  }
  return { valid: true };
}

async function parse(fileText: string): Promise<ImportParseResult> {
  return parseCsvTransactions(fileText, { aliases: BANK_CSV_ALIASES, defaultCurrency: "usd" });
}

export const csvBankImportProvider: ImportProvider = {
  id: "csv_bank",
  label: "Bank CSV",
  description: "Upload a CSV exported from your bank to automatically detect recurring subscription payments.",
  acceptedFileTypes: [".csv", "text/csv"],
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  enabled: true,
  validate,
  parse,
};
