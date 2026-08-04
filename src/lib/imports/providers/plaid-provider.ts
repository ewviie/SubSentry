import { CountryCode, Products } from "plaid";
import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";
import { isPlaidConfigured, getPlaidClient } from "../plaid-client";
import { plaidTransactionsToRawTransactions } from "../plaid-transform";

// How far back /transactions/get looks on a first-time fetch. Long enough
// to give the detection engine (which wants 2-3+ occurrences to call
// something "recurring", see detection.ts) real history to work with,
// short enough to stay well under Plaid's per-request transaction caps.
// Exported so the link-token route can request this same window from Plaid
// up front (via LinkTokenTransactions.days_requested) — Plaid's own default
// there is only 90 days, which would silently cap how much history is ever
// available to fetchTransactions() below regardless of what start_date it
// asks for.
export const LOOKBACK_DAYS = 365;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Plaid is a live-API provider, not a file-upload one — validate()/parse()
// exist only so it satisfies the same ImportProvider shape uniformly (see
// provider.ts's comment on fetchTransactions). The real entry point is
// fetchTransactions(); the analyze route's file-upload path never calls
// this provider at all (see /api/imports/plaid/sync instead).
function validate(): { valid: true } | { valid: false; reason: string } {
  return { valid: false, reason: "Plaid connects directly to your bank — there's no file to upload." };
}

async function parse(): Promise<ImportParseResult> {
  throw new Error("Plaid import has no file to parse. Use fetchTransactions() with a linked access token instead.");
}

async function fetchTransactions(accessToken: string): Promise<ImportParseResult> {
  const client = getPlaidClient();
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - LOOKBACK_DAYS * 86_400_000);

  // /transactions/get paginates via total_transactions/offset — a fresh
  // Item with a year of history can exceed one page's default count.
  const transactions = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const response = await client.transactionsGet({
      access_token: accessToken,
      start_date: isoDate(startDate),
      end_date: isoDate(endDate),
      options: { offset },
    });
    transactions.push(...response.data.transactions);
    total = response.data.total_transactions;
    offset += response.data.transactions.length;
    // A page that returns nothing would spin this loop forever even though
    // `total` claims more remain — bail rather than hang.
    if (response.data.transactions.length === 0) break;
  }

  return plaidTransactionsToRawTransactions(transactions);
}

export const plaidImportProvider: ImportProvider = {
  id: "plaid",
  label: "Bank (Plaid)",
  description: "Securely connect your bank account via Plaid to automatically detect recurring subscriptions.",
  acceptedFileTypes: [],
  maxFileSizeBytes: 0,
  get enabled() {
    return isPlaidConfigured();
  },
  validate,
  parse,
  fetchTransactions,
};

// Shared with the link-token route — Plaid Link needs to know which
// products/countries to request, and duplicating these literals at each
// call site risks them drifting apart from what this provider actually
// uses (Products.Transactions, matching fetchTransactions() above).
export const PLAID_LINK_PRODUCTS = [Products.Transactions];
export const PLAID_LINK_COUNTRY_CODES = [CountryCode.Us];
