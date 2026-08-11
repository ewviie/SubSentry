import type { AIProvider, ParsedSubscriptionResult } from "./provider";
import type { ComputedInsight } from "@/lib/subscriptions/insights";
import { normalizeName } from "@/lib/subscriptions/insights";
import { CATEGORIES } from "@/lib/subscriptions/validation";
import { KNOWN_MERCHANTS } from "@/lib/imports/merchant-normalizer";

const CURRENCY_SYMBOLS: Record<string, string> = { "£": "gbp", "€": "eur", "$": "usd", "¥": "jpy" };
const CYCLE_KEYWORDS: Record<string, ParsedSubscriptionResult["billingCycle"]> = {
  year: "yearly",
  yr: "yearly",
  annual: "yearly",
  month: "monthly",
  week: "weekly",
  quarter: "quarterly",
};

// Longest alias first: KNOWN_MERCHANTS has both a generic "apple" (bank
// descriptors like "APL*ITUNES.COM/BILL" can't tell Apple Music from
// iCloud+, so that entry is deliberately generic — see
// merchant-normalizer.ts) and a specific "applemusic" — checking longest
// first means typing "Apple Music" in quick-add matches the specific
// streaming entry, not the shorter, less-precise "apple" one.
//
// >= 4 chars only — same gate merchant-normalizer.ts's own substring
// matcher uses (see its FUZZY_MIN_KEY_LENGTH/length-4 comment): a short
// alias like "max" (HBO's rebrand) is a real merchant but too short to
// safely substring-match against a whole free-typed sentence rather than
// a terse bank descriptor — "my max budget this month" would otherwise
// false-positive as HBO Max.
const KNOWN_MERCHANT_ALIASES = Object.keys(KNOWN_MERCHANTS)
  .filter((alias) => alias.length >= 4)
  .sort((a, b) => b.length - a.length);

// Categories/services genuinely absent from KNOWN_MERCHANTS (which is
// curated for bank-descriptor matching — brand names, not generic word
// patterns like "gym" or "news") — checked only after KNOWN_MERCHANTS
// finds nothing, so a real, curated merchant match always wins over a
// generic keyword guess.
const FALLBACK_CATEGORY_KEYWORDS: Partial<Record<(typeof CATEGORIES)[number], string[]>> = {
  fitness: ["gym", "peloton", "strava", "fitness"],
  gaming: ["steam", "nintendo"],
  news: ["times", "post", "journal", "news"],
};

// No API key configured — a keyless, regex-based heuristic parser so the
// quick-add loop (type text -> see a structured draft -> confirm) is fully
// demoable without secrets, matching the demo-mode pattern already used
// elsewhere in this codebase.
export class DemoProvider implements AIProvider {
  async parseSubscriptionText(text: string): Promise<ParsedSubscriptionResult> {
    // Prefer a currency-symbol-prefixed number over a bare one — otherwise
    // a product name containing a number (e.g. "Office 365 $6.99/mo") would
    // match "365" as the amount instead of the actual price, since it
    // appears first in the string.
    const symbolMatch = text.match(/([£€$¥])\s?(\d+(?:\.\d{1,2})?)/);
    const bareMatch = text.match(/(\d+(?:\.\d{1,2})?)/);
    const amountMatch = symbolMatch ?? bareMatch;
    const amount = symbolMatch ? symbolMatch[2] : bareMatch ? bareMatch[1] : "0.00";
    const currency = symbolMatch ? CURRENCY_SYMBOLS[symbolMatch[1]] : "usd";

    const lower = text.toLowerCase();
    let billingCycle: ParsedSubscriptionResult["billingCycle"] = "monthly";
    for (const [keyword, cycle] of Object.entries(CYCLE_KEYWORDS)) {
      if (lower.includes(keyword)) {
        billingCycle = cycle;
        break;
      }
    }

    // "other" is a real, honest answer when nothing matches — never
    // overridden with a guessed category this parser can't back — but it
    // shouldn't be reached just because a merchant this app already knows
    // (KNOWN_MERCHANTS, shared with the CSV/bank-import path) wasn't
    // checked. Real curated data first, generic keyword fallback second.
    let category: (typeof CATEGORIES)[number] = "other";
    const normalizedText = normalizeName(text);
    const matchedAlias = KNOWN_MERCHANT_ALIASES.find((alias) => normalizedText.includes(alias));
    if (matchedAlias) {
      category = KNOWN_MERCHANTS[matchedAlias].category;
    } else {
      for (const [cat, keywords] of Object.entries(FALLBACK_CATEGORY_KEYWORDS)) {
        if (keywords?.some((k) => lower.includes(k))) {
          category = cat as (typeof CATEGORIES)[number];
          break;
        }
      }
    }

    // Strip whichever match actually supplied the amount (symbol-prefixed
    // or bare — amountMatch is already resolved to the one that won above),
    // not just the symbol-prefixed pattern unconditionally. That fixed
    // pattern alone left the number sitting in the name for any input
    // with no currency symbol at all ("Netflix 15.99 monthly" → name
    // "Netflix 15.99" — a real bug, not a demo-mode quirk to shrug off,
    // since this is exactly the text a user re-reads to check SubSentry
    // understood them). A number that's genuinely part of a name ("Office
    // 365") is untouched whenever a symbol elsewhere in the string already
    // won the amount match instead (see the "Office 365 $6.99/mo" case
    // above) — only the specific substring that became the amount is ever
    // removed, never every digit in the text.
    //
    // Two separate passes below: \b requires a word-character/non-word-
    // character transition, which never matches directly before "/" when
    // it's preceded by whitespace (e.g. "$139 /yr") — so the slash-prefixed
    // shorthand can't share a \b-bounded alternation with the word-based
    // terms the way "/mo"|"/yr" previously did.
    const name = text
      .replace(amountMatch ? amountMatch[0] : "", "")
      .replace(/\b(monthly|yearly|annual|weekly|quarterly|per month|per year)\b/gi, "")
      .replace(/\/(mo|yr)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (c) => c.toUpperCase()) || "New subscription";

    return {
      name,
      amount: Number(amount).toFixed(2),
      currency,
      billingCycle,
      category,
      // This heuristic parser never actually looks for a date in the text —
      // returning null (not "today") means the confirm form's required date
      // field forces the user to pick one, rather than presenting an
      // unparsed guess as if it meant something.
      nextRenewalDate: null,
      confidence: amountMatch ? "medium" : "low",
    };
  }

  async narrateInsights(insights: ComputedInsight[]): Promise<string[]> {
    return insights.map((i) => i.description);
  }
}
