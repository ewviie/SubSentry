import { levenshtein, normalizeName } from "@/lib/subscriptions/insights";
import type { Subscription } from "@/lib/db/schema";
import type { MerchantMatch } from "./types";

interface CanonicalMerchant {
  displayName: string;
  category: Subscription["category"];
  // Every normalized string (normalizeName()'s output shape: lowercase,
  // alphanumeric only) that should resolve to this merchant — brand-name
  // variants, common misspellings a bank descriptor might use, and
  // international/localized names all live here as plain aliases rather
  // than separate KNOWN_MERCHANTS entries, so updating a merchant's
  // category or display name is a one-line change instead of N.
  aliases: string[];
}

// Curated known-subscription-merchant table, grouped by canonical merchant
// so adding an alias is a one-line addition to an existing entry's array
// rather than a whole new duplicated {displayName, category} object.
const CANONICAL_MERCHANTS: CanonicalMerchant[] = [
  { displayName: "Netflix", category: "streaming", aliases: ["netflix"] },
  { displayName: "Spotify", category: "streaming", aliases: ["spotify"] },
  { displayName: "Disney+", category: "streaming", aliases: ["disney", "disneyplus"] },
  { displayName: "Hulu", category: "streaming", aliases: ["hulu"] },
  { displayName: "HBO Max", category: "streaming", aliases: ["hbomax"] },
  { displayName: "Max", category: "streaming", aliases: ["max"] },
  { displayName: "Prime Video", category: "streaming", aliases: ["primevideo"] },
  { displayName: "YouTube Premium", category: "streaming", aliases: ["youtube", "youtubepremium"] },
  { displayName: "YouTube TV", category: "streaming", aliases: ["youtubetv"] },
  { displayName: "Paramount+", category: "streaming", aliases: ["paramount", "paramountplus"] },
  { displayName: "Peacock", category: "streaming", aliases: ["peacock"] },
  { displayName: "Discovery+", category: "streaming", aliases: ["discoveryplus"] },
  { displayName: "Crunchyroll", category: "streaming", aliases: ["crunchyroll"] },
  { displayName: "Audible", category: "streaming", aliases: ["audible"] },
  // DAZN and Canal+ are internationally-known subscription services
  // (sports/TV) with little presence in a US-centric merchant list —
  // included since bank/card descriptors for these are common in UK/EU
  // exports specifically.
  { displayName: "DAZN", category: "streaming", aliases: ["dazn"] },
  { displayName: "Canal+", category: "streaming", aliases: ["canalplus"] },
  { displayName: "Adobe", category: "software", aliases: ["adobe"] },
  // "itunes" covers Apple's real billing descriptor for subscriptions,
  // typically seen as "APL*ITUNES.COM/BILL" on a card statement.
  { displayName: "Apple", category: "software", aliases: ["apple", "itunes"] },
  { displayName: "Google", category: "software", aliases: ["google"] },
  { displayName: "Google One", category: "software", aliases: ["googleone"] },
  { displayName: "Amazon", category: "other", aliases: ["amazon", "amzn"] },
  { displayName: "Amazon Prime", category: "other", aliases: ["amazonprime"] },
  { displayName: "Microsoft", category: "software", aliases: ["microsoft"] },
  { displayName: "Dropbox", category: "software", aliases: ["dropbox"] },
  { displayName: "Canva", category: "software", aliases: ["canva"] },
  { displayName: "ChatGPT", category: "software", aliases: ["chatgpt", "openai"] },
  { displayName: "Claude", category: "software", aliases: ["claude", "anthropic"] },
  { displayName: "GitHub", category: "software", aliases: ["github"] },
  { displayName: "Slack", category: "software", aliases: ["slack"] },
  { displayName: "Zoom", category: "software", aliases: ["zoom"] },
  { displayName: "Notion", category: "software", aliases: ["notion"] },
  { displayName: "Figma", category: "software", aliases: ["figma"] },
  { displayName: "1Password", category: "software", aliases: ["1password", "onepassword"] },
  { displayName: "NordVPN", category: "software", aliases: ["nordvpn"] },
  { displayName: "ExpressVPN", category: "software", aliases: ["expressvpn"] },
  { displayName: "LinkedIn Premium", category: "software", aliases: ["linkedinpremium"] },
  { displayName: "Patreon", category: "other", aliases: ["patreon"] },
  { displayName: "Substack", category: "news", aliases: ["substack"] },
  { displayName: "PlayStation Plus", category: "gaming", aliases: ["playstation", "playstationplus"] },
  { displayName: "Xbox Game Pass", category: "gaming", aliases: ["xbox", "xboxgamepass", "gamepass"] },
];

export const KNOWN_MERCHANTS: Record<string, { displayName: string; category: Subscription["category"] }> =
  Object.fromEntries(
    CANONICAL_MERCHANTS.flatMap((merchant) =>
      merchant.aliases.map((alias) => [alias, { displayName: merchant.displayName, category: merchant.category }]),
    ),
  );

// Matches a leading payment-processor prefix like "SQ *", "SP *", "TST*",
// "PAYPAL *" — these appear directly against the merchant name with no
// separator, so without stripping them "SQ *SPOTIFY" would never come
// within a useful edit distance of "spotify". GOOGLE and APL cover Google
// Play's and Apple's own billing-descriptor formats specifically (real
// card statements show charges as "GOOGLE *NETFLIX" or "APL*ITUNES.COM/BILL"
// when a subscription is billed through either platform on a linked card)
// — requiring the literal "*" means a bare "GOOGLE" charge (a Google One
// subscription billed directly, no passthrough merchant) is left untouched
// rather than stripped to nothing.
const PROCESSOR_PREFIX_PATTERN = /^(SQ|SP|TST|PAYPAL|PP|CKO|STRIPE|SQUARE|GOOGLE|APL)\s*\*\s*/i;
const DOMAIN_SUFFIX_PATTERN = /\.(com|co\.uk|net|org|io|app)\b/gi;
// A trailing run of 3+ digits (with optional interspersed spaces/dashes) —
// transaction IDs, phone numbers, store numbers. Requires 3+ so short
// legitimate merchant-name numbers ("7-Eleven") aren't chewed into.
const TRAILING_DIGIT_RUN_PATTERN = /[\s\-]*\d[\d\s\-]{2,}$/;
// A trailing short (2-3 letter) all-caps token — country/state codes like
// "NLD", "CA", "USA" — only when preceded by whitespace, so it can't eat
// into a real word.
const TRAILING_CODE_PATTERN = /\s+[A-Z]{2,3}$/;

// Split into two stages rather than one combined strip: the trailing-code
// removal is the aggressive, riskier step — a genuine 2-3 letter product
// word at the end of a merchant name ("Google ONE", "HBO MAX") looks
// identical in shape to a trailing country/state code ("NETFLIX NLD"), so
// there's no regex that can tell them apart. normalizeMerchant() below
// tries a match against the lightly-stripped form FIRST, before the
// aggressive stage ever runs, so a known merchant whose real name ends in
// one of those words is matched before it can be mangled.
function stripProcessorAndDomainNoise(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(PROCESSOR_PREFIX_PATTERN, "");
  cleaned = cleaned.replace(DOMAIN_SUFFIX_PATTERN, "");
  cleaned = cleaned.replace(TRAILING_DIGIT_RUN_PATTERN, "");
  return cleaned.trim();
}

export function stripPaymentProcessorNoise(raw: string): string {
  return stripProcessorAndDomainNoise(raw).replace(TRAILING_CODE_PATTERN, "").trim();
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
// Below this length, edit-distance-2 tolerance is too loose relative to the
// key's own size (e.g. "max" at distance 2 would match almost anything
// 1-5 characters long) — short keys only ever match via the exact or
// substring paths above, never fuzzily.
const FUZZY_MIN_KEY_LENGTH = 4;

function findKnownMerchant(key: string): { displayName: string; category: Subscription["category"] } | null {
  return key && KNOWN_MERCHANTS[key] ? KNOWN_MERCHANTS[key] : null;
}

// Substring containment, gated to keys >= 4 chars so short keys ("max")
// can't accidentally match as a substring of an unrelated longer word.
function findKnownMerchantBySubstring(key: string): { displayName: string; category: Subscription["category"] } | null {
  for (const [candidate, info] of Object.entries(KNOWN_MERCHANTS)) {
    if (candidate.length >= 4 && key.includes(candidate)) return info;
  }
  return null;
}

export function normalizeMerchant(raw: string): MerchantMatch {
  const lightlyStripped = stripProcessorAndDomainNoise(raw);
  const lightKey = normalizeName(lightlyStripped);
  const rawKey = normalizeName(raw);

  // Tried before the aggressive trailing-code strip runs, so a real
  // merchant name ending in a short product word ("Google ONE", "HBO MAX")
  // is matched here first — see stripPaymentProcessorNoise's comment.
  const lightMatch = findKnownMerchant(lightKey) ?? findKnownMerchantBySubstring(lightKey);
  if (lightMatch) return { ...lightMatch, isKnownSubscriptionMerchant: true };

  const stripped = stripPaymentProcessorNoise(raw);
  const strippedKey = normalizeName(stripped);

  const strippedMatch =
    findKnownMerchant(strippedKey) ??
    findKnownMerchantBySubstring(strippedKey) ??
    // Substring against the essentially-raw (only alphanumeric-normalized)
    // form too — catches cases where the light/aggressive stripping missed
    // noise the substring check alone still cuts through, e.g.
    // "NETFLIX.COM AMSTERDAM" -> "netflixcomamsterdam".includes("netflix").
    findKnownMerchantBySubstring(rawKey);
  if (strippedMatch) return { ...strippedMatch, isKnownSubscriptionMerchant: true };

  // Fuzzy fallback, only against the fully-stripped form — the raw form is
  // usually too much longer than a short merchant key for edit distance to
  // be meaningful.
  if (strippedKey) {
    for (const [key, info] of Object.entries(KNOWN_MERCHANTS)) {
      if (key.length < FUZZY_MIN_KEY_LENGTH) continue;
      if (Math.abs(strippedKey.length - key.length) > FUZZY_MAX_LENGTH_DELTA) continue;
      if (levenshtein(strippedKey, key) <= FUZZY_MAX_DISTANCE) {
        return { displayName: info.displayName, category: info.category, isKnownSubscriptionMerchant: true };
      }
    }
  }

  const fallbackDisplayName = titleCase(stripped) || raw.trim();
  return { displayName: fallbackDisplayName, category: "other", isKnownSubscriptionMerchant: false };
}
