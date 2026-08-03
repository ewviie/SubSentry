import { levenshtein, normalizeName } from "@/lib/subscriptions/insights";
import type { Subscription } from "@/lib/db/schema";
import type { MerchantMatch } from "./types";

// Curated known-subscription-merchant table. Keys are already in
// normalizeName()'s output shape (lowercase, alphanumeric only) so lookups
// never need to re-normalize the key side. Deliberately extendable — this
// is a plain object literal, not a generated list, so adding a new merchant
// is a one-line change.
export const KNOWN_MERCHANTS: Record<string, { displayName: string; category: Subscription["category"] }> = {
  netflix: { displayName: "Netflix", category: "streaming" },
  spotify: { displayName: "Spotify", category: "streaming" },
  disney: { displayName: "Disney+", category: "streaming" },
  disneyplus: { displayName: "Disney+", category: "streaming" },
  hulu: { displayName: "Hulu", category: "streaming" },
  hbomax: { displayName: "HBO Max", category: "streaming" },
  primevideo: { displayName: "Prime Video", category: "streaming" },
  adobe: { displayName: "Adobe", category: "software" },
  apple: { displayName: "Apple", category: "software" },
  google: { displayName: "Google", category: "software" },
  googleone: { displayName: "Google One", category: "software" },
  amazon: { displayName: "Amazon", category: "other" },
  amazonprime: { displayName: "Amazon Prime", category: "other" },
  microsoft: { displayName: "Microsoft", category: "software" },
  dropbox: { displayName: "Dropbox", category: "software" },
  canva: { displayName: "Canva", category: "software" },
  chatgpt: { displayName: "ChatGPT", category: "software" },
  openai: { displayName: "ChatGPT", category: "software" },
  claude: { displayName: "Claude", category: "software" },
  anthropic: { displayName: "Claude", category: "software" },
  github: { displayName: "GitHub", category: "software" },
  slack: { displayName: "Slack", category: "software" },
  zoom: { displayName: "Zoom", category: "software" },
  notion: { displayName: "Notion", category: "software" },
  figma: { displayName: "Figma", category: "software" },
};

// Matches a leading payment-processor prefix like "SQ *", "SP *", "TST*",
// "PAYPAL *" — these appear directly against the merchant name with no
// separator, so without stripping them "SQ *SPOTIFY" would never come
// within a useful edit distance of "spotify".
const PROCESSOR_PREFIX_PATTERN = /^(SQ|SP|TST|PAYPAL|PP|CKO|STRIPE|SQUARE)\s*\*\s*/i;
const DOMAIN_SUFFIX_PATTERN = /\.(com|co\.uk|net|org|io|app)\b/gi;
// A trailing run of 3+ digits (with optional interspersed spaces/dashes) —
// transaction IDs, phone numbers, store numbers. Requires 3+ so short
// legitimate merchant-name numbers ("7-Eleven") aren't chewed into.
const TRAILING_DIGIT_RUN_PATTERN = /[\s\-]*\d[\d\s\-]{2,}$/;
// A trailing short (2-3 letter) all-caps token — country/state codes like
// "NLD", "CA", "USA" — only when preceded by whitespace, so it can't eat
// into a real word.
const TRAILING_CODE_PATTERN = /\s+[A-Z]{2,3}$/;

export function stripPaymentProcessorNoise(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(PROCESSOR_PREFIX_PATTERN, "");
  cleaned = cleaned.replace(DOMAIN_SUFFIX_PATTERN, "");
  cleaned = cleaned.replace(TRAILING_DIGIT_RUN_PATTERN, "");
  cleaned = cleaned.replace(TRAILING_CODE_PATTERN, "");
  return cleaned.trim();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Edit distance is always >= the length difference, so this short-circuits
// the same way insights.ts's namesLikelyMatch does, avoiding the O(n*m) DP
// for pairs that could never pass anyway.
const FUZZY_MAX_LENGTH_DELTA = 3;
const FUZZY_MAX_DISTANCE = 2;

export function normalizeMerchant(raw: string): MerchantMatch {
  const stripped = stripPaymentProcessorNoise(raw);
  const strippedKey = normalizeName(stripped);
  const rawKey = normalizeName(raw);

  if (strippedKey && KNOWN_MERCHANTS[strippedKey]) {
    const { displayName, category } = KNOWN_MERCHANTS[strippedKey];
    return { displayName, category, isKnownSubscriptionMerchant: true };
  }

  // Substring containment on both the stripped and raw normalized forms —
  // catches "NETFLIX.COM AMSTERDAM" -> "netflixcomamsterdam".includes("netflix")
  // even when the location/domain-suffix stripping above didn't fully
  // clean the string.
  for (const [key, info] of Object.entries(KNOWN_MERCHANTS)) {
    if (key.length >= 4 && (strippedKey.includes(key) || rawKey.includes(key))) {
      return { displayName: info.displayName, category: info.category, isKnownSubscriptionMerchant: true };
    }
  }

  // Fuzzy fallback, only against the stripped (noise-reduced) form — the
  // raw form is usually too much longer than a short merchant key for edit
  // distance to be meaningful.
  if (strippedKey) {
    for (const [key, info] of Object.entries(KNOWN_MERCHANTS)) {
      if (Math.abs(strippedKey.length - key.length) > FUZZY_MAX_LENGTH_DELTA) continue;
      if (levenshtein(strippedKey, key) <= FUZZY_MAX_DISTANCE) {
        return { displayName: info.displayName, category: info.category, isKnownSubscriptionMerchant: true };
      }
    }
  }

  const fallbackDisplayName = titleCase(stripped) || raw.trim();
  return { displayName: fallbackDisplayName, category: "other", isKnownSubscriptionMerchant: false };
}
