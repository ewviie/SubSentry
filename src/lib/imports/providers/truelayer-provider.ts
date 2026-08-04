import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";
import { isTrueLayerConfigured, fetchAccounts, fetchAccountTransactions } from "../truelayer-client";
import { trueLayerTransactionsToRawTransactions, type TrueLayerRawTransaction } from "../truelayer-transform";

// Same lookback window as plaid-provider.ts, for the same reason: enough
// history for detection.ts to call something "recurring" without pulling
// more than a first-time connection realistically needs.
const LOOKBACK_DAYS = 365;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validate(): { valid: true } | { valid: false; reason: string } {
  return { valid: false, reason: "TrueLayer connects directly to your bank — there's no file to upload." };
}

async function parse(): Promise<ImportParseResult> {
  throw new Error("TrueLayer import has no file to parse. Use fetchTransactions() with a linked access token instead.");
}

// Unlike Plaid's /transactions/get (one call returns every account under an
// Item), TrueLayer's Data API is per-account — list the accounts this
// access token can see, then fetch and merge each one's transactions. Still
// converges on the same ImportParseResult, so nothing downstream cares.
async function fetchTransactions(accessToken: string): Promise<ImportParseResult> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - LOOKBACK_DAYS * 86_400_000);
  const from = isoDate(startDate);
  const to = isoDate(endDate);

  const accounts = await fetchAccounts(accessToken);
  const allTransactions: TrueLayerRawTransaction[] = [];
  for (const account of accounts) {
    const transactions = await fetchAccountTransactions(accessToken, account.account_id, from, to);
    allTransactions.push(...transactions);
  }

  return trueLayerTransactionsToRawTransactions(allTransactions);
}

export const trueLayerImportProvider: ImportProvider = {
  id: "truelayer",
  label: "Bank (TrueLayer)",
  description: "Securely connect your bank account via TrueLayer to automatically detect recurring subscriptions.",
  acceptedFileTypes: [],
  maxFileSizeBytes: 0,
  get enabled() {
    return isTrueLayerConfigured();
  },
  validate,
  parse,
  fetchTransactions,
};
