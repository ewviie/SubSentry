import { amountStringToCents } from "@/lib/subscriptions/money";
import { cleanAmountString } from "./csv-parser";
import type { GmailMessage, GmailMessagePart } from "./gmail-client";
import type { ImportParseResult, RawTransaction } from "./types";

// Gmail search query, not a full-text scan of the inbox: `q` is Gmail's own
// search syntax (same as the search box in the Gmail UI), so this narrows
// server-side to a realistically small slice of a real inbox before a
// single message body is ever fetched — matching gmail.readonly's minimal
// intent (read what's needed, not the whole mailbox). newer_than:1y caps
// the lookback the same way LOOKBACK_DAYS does for plaid/truelayer.
export const GMAIL_SEARCH_QUERY =
  'newer_than:1y (subject:(receipt OR renewal OR invoice OR "payment confirmation" OR "your subscription" OR "order confirmation") OR from:(billing OR receipts OR noreply OR no-reply))';

// Realistically small: a subscription receipt search should surface tens
// of matches, not hundreds, in a normal inbox — this bounds one sync's
// total Gmail API calls (one messages.list + up to this many messages.get)
// to something that finishes well inside the sync route's own request
// lifetime, not an unbounded scan.
export const MAX_MESSAGES_PER_SYNC = 50;

// A source-agnostic $/€/£-prefixed (or trailing 3-letter-code) amount.
// Anchored to a currency marker on purpose — a bare number in a receipt
// email is just as likely to be an order id, a quantity, or part of a
// date as an amount, and this app's own "never fabricate a number"
// principle means a wrong extraction is worse than no extraction; a
// missed subscription can be added manually, a wrong one silently
// corrupts real financial data.
const AMOUNT_RE = /(?:total|amount(?: due| charged)?|you paid|charged|payment of|price)\D{0,20}([$€£]\s?\d[\d,]*(?:\.\d{2})?)/i;
const FALLBACK_AMOUNT_RE = /([$€£]\s?\d[\d,]*(?:\.\d{2})?)/;
const CURRENCY_BY_SYMBOL: Record<string, string> = { $: "usd", "€": "eur", "£": "gbp" };

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Any real message (even a deeply nested multipart/mixed-with-attachments
// one) bottoms out in a handful of levels — mail clients that build MIME
// trees don't nest more than this in practice. Bounds `walk` below against
// a maliciously-crafted message with a pathologically deep (or cyclic, if a
// malformed payload ever looped back on itself) `parts` tree, which would
// otherwise recurse without limit and risk a stack overflow on that one
// request. This is a message Gmail's own search already surfaced as a
// receipt/renewal candidate (see GMAIL_SEARCH_QUERY) — narrow, but not
// something this app controls the shape of, since it's whatever a sender
// crafted.
const MAX_MIME_DEPTH = 10;

// Gmail's payload is a MIME tree, not a flat body — a multipart/alternative
// message nests text/plain and text/html as siblings, and either can
// itself be nested under multipart/mixed (e.g. alongside an attachment).
// Prefers text/plain (already clean, no tags to strip) and only falls back
// to text/html if no plain part exists.
function extractBodyText(payload: GmailMessage["payload"]): string {
  if (!payload) return "";

  let plain: string | null = null;
  let html: string | null = null;

  function walk(part: GmailMessagePart, depth: number) {
    if (depth > MAX_MIME_DEPTH) return;
    if (part.mimeType === "text/plain" && part.body?.data && !plain) {
      plain = decodeBase64Url(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }
    for (const child of part.parts ?? []) walk(child, depth + 1);
  }
  walk(payload, 0);

  if (plain) return plain;
  if (html) return stripHtml(html);
  return "";
}

function getHeader(payload: GmailMessage["payload"], name: string): string | null {
  return payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

// "Netflix <billing@netflix.com>" -> "Netflix"; a bare
// "billing@netflix.com" (no display name) falls back to the local part of
// the address, title-cased, since that's still a more useful merchant
// label than the raw email string.
function senderDisplayName(fromHeader: string): string {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  if (match) return match[1].trim();
  const localPart = fromHeader.split("@")[0];
  return localPart.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractAmount(text: string): { amountCents: number; currency: string } | null {
  const match = text.match(AMOUNT_RE) ?? text.match(FALLBACK_AMOUNT_RE);
  if (!match) return null;
  const raw = match[1];
  const symbol = raw.trim()[0];
  const currency = CURRENCY_BY_SYMBOL[symbol] ?? "usd";
  const amountCents = amountStringToCents(cleanAmountString(raw));
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
  return { amountCents, currency };
}

// Converts a batch of already-fetched Gmail messages into the same
// source-agnostic RawTransaction[] shape every other provider produces —
// from here on, this flows through the identical
// analyzeParsedTransactions()/detectRecurringSubscriptions() pipeline a
// CSV upload or a Plaid transaction does. A message this app's own
// heuristic can't confidently extract an amount from is skipped with a
// warning, never guessed at — consistent with csv-parser.ts's handling of
// an unreadable row.
export function extractTransactionsFromMessages(messages: GmailMessage[]): ImportParseResult {
  const transactions: RawTransaction[] = [];
  const warnings: string[] = [];
  let skippedRowCount = 0;

  for (const message of messages) {
    const bodyText = extractBodyText(message.payload) || message.snippet;
    const subject = getHeader(message.payload, "Subject") ?? "";
    const from = getHeader(message.payload, "From") ?? "";
    const amount = extractAmount(`${subject} ${bodyText}`);

    if (!amount) {
      skippedRowCount += 1;
      continue;
    }

    const merchant = from ? senderDisplayName(from) : subject.trim();
    if (!merchant) {
      skippedRowCount += 1;
      continue;
    }

    const internalDateMs = Number(message.internalDate);
    const date = Number.isFinite(internalDateMs)
      ? new Date(internalDateMs).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    transactions.push({
      date,
      description: merchant,
      amountCents: amount.amountCents,
      direction: "debit",
      currency: amount.currency,
      reference: message.id,
    });
  }

  if (skippedRowCount > 0) {
    warnings.push(
      `${skippedRowCount} email${skippedRowCount === 1 ? "" : "s"} matched the search but couldn't be confidently read as a charge, and ${skippedRowCount === 1 ? "was" : "were"} skipped.`,
    );
  }

  return { transactions, warnings, skippedRowCount };
}
