import type { ImportProvider } from "../provider";
import type { ImportParseResult } from "../types";
import { isGmailConfigured, searchMessages, fetchMessage } from "../gmail-client";
import { GMAIL_SEARCH_QUERY, MAX_MESSAGES_PER_SYNC, extractTransactionsFromMessages } from "../gmail-extract";

function validate(): { valid: true } | { valid: false; reason: string } {
  return { valid: false, reason: "Gmail connects directly to your inbox — there's no file to upload." };
}

async function parse(): Promise<ImportParseResult> {
  throw new Error("Gmail import has no file to parse. Use fetchTransactions() with a linked access token instead.");
}

// Searches Gmail (server-side query, not a full-inbox scan — see
// GMAIL_SEARCH_QUERY's own comment), fetches each matching message, and
// extracts what looks like a subscription charge from it. Converges on the
// same ImportParseResult every other provider produces — from here,
// nothing downstream (detection, review UI, confirm API) knows or cares
// this came from an inbox instead of a bank or a CSV.
async function fetchTransactions(accessToken: string): Promise<ImportParseResult> {
  const messageSummaries = await searchMessages(accessToken, GMAIL_SEARCH_QUERY, MAX_MESSAGES_PER_SYNC);
  const messages = await Promise.all(messageSummaries.map((m) => fetchMessage(accessToken, m.id)));
  return extractTransactionsFromMessages(messages);
}

export const gmailImportProvider: ImportProvider = {
  id: "gmail",
  label: "Google (Gmail)",
  description: "Scans your Gmail for subscription receipts and renewal emails to detect active subscriptions.",
  acceptedFileTypes: [],
  maxFileSizeBytes: 0,
  get enabled() {
    return isGmailConfigured();
  },
  validate,
  parse,
  fetchTransactions,
};
