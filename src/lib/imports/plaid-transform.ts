import { amountStringToCents } from "@/lib/subscriptions/money";
import { neutralizeFormulaInjection } from "./sanitize";
import type { ImportParseResult, RawTransaction } from "./types";

// A minimal structural subset of Plaid's real `Transaction` type (from the
// `plaid` SDK's api.d.ts) — only the fields this adapter actually reads.
// Plaid's real transaction objects satisfy this automatically (TypeScript
// structural typing), so plaid-provider.ts can pass its SDK responses
// straight through without an explicit cast, while this file — and its
// tests — stay decoupled from the SDK's full, heavyweight response shape.
export interface PlaidRawTransaction {
  transaction_id: string;
  date: string; // already ISO YYYY-MM-DD, per Plaid's docs
  name: string;
  merchant_name?: string | null;
  // Plaid's own sign convention: positive = money leaving the account
  // (debit), negative = money moving in (credit) — the inverse of how a
  // typical bank CSV's signed column reads, and already exactly the
  // direction split RawTransaction needs, no extra inference required.
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  pending: boolean;
}

// Pure adapter: Plaid's transaction shape in, the same ImportParseResult
// every file-based provider's parse() returns out. This is the literal
// "conversion into RawTransaction[]" the architecture calls for — detection,
// merchant normalization, and confidence scoring downstream never know or
// care that this data came from a live API rather than an uploaded file.
export function plaidTransactionsToRawTransactions(transactions: PlaidRawTransaction[]): ImportParseResult {
  const result: RawTransaction[] = [];
  const warnings: string[] = [];
  let skippedRowCount = 0;

  for (const transaction of transactions) {
    // Pending transactions can still change amount/category before they
    // settle — treating one as a confirmed charge risks detecting a
    // "subscription" off a value that's about to move.
    if (transaction.pending) {
      skippedRowCount++;
      continue;
    }
    if (transaction.amount === 0) {
      skippedRowCount++;
      continue;
    }
    const currency = transaction.iso_currency_code ?? transaction.unofficial_currency_code;
    if (!currency) {
      warnings.push(`Transaction ${transaction.transaction_id}: no currency code, skipped.`);
      skippedRowCount++;
      continue;
    }
    const description = transaction.merchant_name || transaction.name;
    if (!description || description.trim() === "") {
      warnings.push(`Transaction ${transaction.transaction_id}: missing merchant name, skipped.`);
      skippedRowCount++;
      continue;
    }

    result.push({
      date: transaction.date,
      description: neutralizeFormulaInjection(description.trim()),
      // toFixed(2) first, not a raw *100 multiplication — Plaid's amount is
      // a float, and 15.99*100 is not reliably exactly 1599 in floating
      // point. Routing through the existing, already-tested string-based
      // amountStringToCents avoids reimplementing that precision handling.
      amountCents: amountStringToCents(Math.abs(transaction.amount).toFixed(2)),
      direction: transaction.amount > 0 ? "debit" : "credit",
      currency: currency.toLowerCase(),
      reference: transaction.transaction_id,
    });
  }

  return { transactions: result, warnings, skippedRowCount };
}
