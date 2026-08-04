import { amountStringToCents } from "@/lib/subscriptions/money";
import { neutralizeFormulaInjection } from "./sanitize";
import type { ImportParseResult, RawTransaction } from "./types";

// A minimal structural subset of TrueLayer's real transaction shape (from
// GET /data/v1/accounts/{id}/transactions) — only the fields this adapter
// reads. Mirrors plaid-transform.ts's PlaidRawTransaction: keeps this file
// and its tests decoupled from the full response shape.
export interface TrueLayerRawTransaction {
  transaction_id: string;
  timestamp: string; // ISO 8601 datetime, e.g. "2026-01-15T00:00:00Z"
  description: string;
  merchant_name?: string | null;
  amount: number;
  currency: string;
  // TrueLayer gives an explicit direction label rather than relying on
  // amount's sign (some account providers report signs inconsistently) —
  // "DEBIT" = money leaving the account, "CREDIT" = money coming in.
  transaction_type: string;
}

export function trueLayerTransactionsToRawTransactions(
  transactions: TrueLayerRawTransaction[],
): ImportParseResult {
  const result: RawTransaction[] = [];
  const warnings: string[] = [];
  let skippedRowCount = 0;

  for (const transaction of transactions) {
    if (transaction.amount === 0) {
      skippedRowCount++;
      continue;
    }
    if (!transaction.currency) {
      warnings.push(`Transaction ${transaction.transaction_id}: no currency code, skipped.`);
      skippedRowCount++;
      continue;
    }
    const description = transaction.merchant_name || transaction.description;
    if (!description || description.trim() === "") {
      warnings.push(`Transaction ${transaction.transaction_id}: missing description, skipped.`);
      skippedRowCount++;
      continue;
    }

    result.push({
      // TrueLayer's timestamp is a full ISO datetime; RawTransaction wants
      // just the YYYY-MM-DD date portion, same convention plaid-transform.ts
      // and every CSV provider already normalize to.
      date: transaction.timestamp.slice(0, 10),
      description: neutralizeFormulaInjection(description.trim()),
      amountCents: amountStringToCents(Math.abs(transaction.amount).toFixed(2)),
      direction: transaction.transaction_type.toUpperCase() === "CREDIT" ? "credit" : "debit",
      currency: transaction.currency.toLowerCase(),
      reference: transaction.transaction_id,
    });
  }

  return { transactions: result, warnings, skippedRowCount };
}
