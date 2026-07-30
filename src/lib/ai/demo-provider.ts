import type { AIProvider, ParsedSubscriptionResult } from "./provider";
import type { ComputedInsight } from "@/lib/subscriptions/insights";
import { CATEGORIES } from "@/lib/subscriptions/validation";

const CURRENCY_SYMBOLS: Record<string, string> = { "£": "gbp", "€": "eur", "$": "usd", "¥": "jpy" };
const CYCLE_KEYWORDS: Record<string, ParsedSubscriptionResult["billingCycle"]> = {
  year: "yearly",
  yr: "yearly",
  annual: "yearly",
  month: "monthly",
  week: "weekly",
  quarter: "quarterly",
};

const CATEGORY_KEYWORDS: Partial<Record<(typeof CATEGORIES)[number], string[]>> = {
  streaming: ["netflix", "spotify", "disney", "hulu", "hbo", "prime video", "youtube"],
  software: ["adobe", "microsoft", "github", "notion", "figma", "office"],
  fitness: ["gym", "peloton", "strava", "fitness"],
  gaming: ["xbox", "playstation", "steam", "nintendo"],
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

    let category: (typeof CATEGORIES)[number] = "other";
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords?.some((k) => lower.includes(k))) {
        category = cat as (typeof CATEGORIES)[number];
        break;
      }
    }

    // Two separate passes: \b requires a word-character/non-word-character
    // transition, which never matches directly before "/" when it's
    // preceded by whitespace (e.g. "$139 /yr") — so the slash-prefixed
    // shorthand can't share a \b-bounded alternation with the word-based
    // terms the way "/mo"|"/yr" previously did.
    const name = text
      .replace(/[£€$¥]\s?\d+(?:\.\d{1,2})?/, "")
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
