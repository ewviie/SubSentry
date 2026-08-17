import { levenshtein, normalizeName } from "@/lib/subscriptions/insights";
import type { Subscription } from "@/lib/db/schema";
import type { MerchantMatch } from "./types";

// Functional-overlap grouping — deliberately much narrower and more
// conservative than `category`. Category answers "what kind of service is
// this" (streaming, software, ...); a group answers "does this
// substantially solve the same problem as another subscription," which
// category alone cannot: Adobe and Dropbox are both "software" but share no
// functional overlap, while Netflix and Spotify are both "streaming" but
// solve completely different problems (video vs. music). Only assigned
// where a genuine, well-known, same-purpose cluster exists in this table —
// most merchants here (GitHub, Slack, Zoom, Notion, Figma, Patreon,
// Substack, Amazon, generic Apple/Google, ...) have no close competitor
// also in the table, or are ambiguous enough (Amazon Prime bundles
// shipping+video+music; YouTube Premium's core value is ad-free video, not
// a Spotify/Apple-Music substitute) that a false "you might not need both"
// claim is worse than saying nothing. Absence of a group is the honest,
// default answer — see resolveOverlapGroup below, which returns null for
// every merchant not listed here.
export type OverlapGroup =
  | "video_streaming"
  | "music_streaming"
  | "creative_tools"
  | "cloud_storage"
  | "vpn"
  | "ai_assistant"
  | "gaming_subscription";

export const OVERLAP_GROUP_LABELS: Record<OverlapGroup, string> = {
  video_streaming: "Video streaming",
  music_streaming: "Music streaming",
  creative_tools: "Creative tools",
  cloud_storage: "Cloud storage",
  vpn: "VPN",
  ai_assistant: "AI assistants",
  gaming_subscription: "Gaming subscriptions",
};

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
  overlapGroup?: OverlapGroup;
}

// Curated known-subscription-merchant table, grouped by canonical merchant
// so adding an alias is a one-line addition to an existing entry's array
// rather than a whole new duplicated {displayName, category} object.
const CANONICAL_MERCHANTS: CanonicalMerchant[] = [
  { displayName: "Netflix", category: "streaming", aliases: ["netflix"], overlapGroup: "video_streaming" },
  { displayName: "Spotify", category: "streaming", aliases: ["spotify"], overlapGroup: "music_streaming" },
  { displayName: "Disney+", category: "streaming", aliases: ["disney", "disneyplus"], overlapGroup: "video_streaming" },
  { displayName: "Hulu", category: "streaming", aliases: ["hulu"], overlapGroup: "video_streaming" },
  { displayName: "HBO Max", category: "streaming", aliases: ["hbomax"], overlapGroup: "video_streaming" },
  { displayName: "Max", category: "streaming", aliases: ["max"], overlapGroup: "video_streaming" },
  { displayName: "Prime Video", category: "streaming", aliases: ["primevideo"], overlapGroup: "video_streaming" },
  // YouTube Premium/TV deliberately NOT in video_streaming — YouTube
  // Premium's core value is ad-free access to user-generated content (not a
  // licensed movie/show library), and YouTube TV is a live-cable
  // replacement — different enough problems from Netflix/Disney+ that
  // grouping them risks a false "you might not need both" claim.
  { displayName: "YouTube Premium", category: "streaming", aliases: ["youtube", "youtubepremium"] },
  { displayName: "YouTube TV", category: "streaming", aliases: ["youtubetv"] },
  { displayName: "Paramount+", category: "streaming", aliases: ["paramount", "paramountplus"], overlapGroup: "video_streaming" },
  { displayName: "Peacock", category: "streaming", aliases: ["peacock"], overlapGroup: "video_streaming" },
  { displayName: "Discovery+", category: "streaming", aliases: ["discoveryplus"], overlapGroup: "video_streaming" },
  { displayName: "Crunchyroll", category: "streaming", aliases: ["crunchyroll"], overlapGroup: "video_streaming" },
  // Audible is audiobooks, not video or music — a genuinely different
  // problem from either group despite sharing the "streaming" category.
  { displayName: "Audible", category: "streaming", aliases: ["audible"] },
  // DAZN and Canal+ are internationally-known subscription services
  // (sports/TV) with little presence in a US-centric merchant list —
  // included since bank/card descriptors for these are common in UK/EU
  // exports specifically. Sports/regional TV is arguably its own problem
  // space, not a substitute for a general on-demand library — left
  // ungrouped rather than guessed.
  { displayName: "DAZN", category: "streaming", aliases: ["dazn"] },
  { displayName: "Canal+", category: "streaming", aliases: ["canalplus"] },
  { displayName: "Adobe", category: "software", aliases: ["adobe"], overlapGroup: "creative_tools" },
  // "itunes" covers Apple's real billing descriptor for subscriptions,
  // typically seen as "APL*ITUNES.COM/BILL" on a card statement — that
  // descriptor never distinguishes Apple Music from iCloud+ or a third-party
  // App Store subscription, so "software" is the safest inference a bank
  // import can make from it alone. "Apple Music" is a separate, more
  // specific entry below for contexts (quick-add's free-typed text) where
  // the actual service name is unambiguous.
  { displayName: "Apple", category: "software", aliases: ["apple", "itunes"] },
  { displayName: "Apple Music", category: "streaming", aliases: ["applemusic"], overlapGroup: "music_streaming" },
  { displayName: "Apple TV+", category: "streaming", aliases: ["appletv", "appletvplus"], overlapGroup: "video_streaming" },
  { displayName: "Google", category: "software", aliases: ["google"] },
  { displayName: "Google One", category: "software", aliases: ["googleone"], overlapGroup: "cloud_storage" },
  { displayName: "Amazon", category: "other", aliases: ["amazon", "amzn"] },
  { displayName: "Amazon Prime", category: "other", aliases: ["amazonprime"] },
  { displayName: "Microsoft", category: "software", aliases: ["microsoft"] },
  { displayName: "Dropbox", category: "software", aliases: ["dropbox"], overlapGroup: "cloud_storage" },
  { displayName: "Canva", category: "software", aliases: ["canva"], overlapGroup: "creative_tools" },
  { displayName: "ChatGPT", category: "software", aliases: ["chatgpt", "openai"], overlapGroup: "ai_assistant" },
  { displayName: "Claude", category: "software", aliases: ["claude", "anthropic"], overlapGroup: "ai_assistant" },
  { displayName: "GitHub", category: "software", aliases: ["github"] },
  { displayName: "Slack", category: "software", aliases: ["slack"] },
  { displayName: "Zoom", category: "software", aliases: ["zoom"] },
  { displayName: "Notion", category: "software", aliases: ["notion"] },
  { displayName: "Figma", category: "software", aliases: ["figma"] },
  { displayName: "1Password", category: "software", aliases: ["1password", "onepassword"] },
  { displayName: "NordVPN", category: "software", aliases: ["nordvpn"], overlapGroup: "vpn" },
  { displayName: "ExpressVPN", category: "software", aliases: ["expressvpn"], overlapGroup: "vpn" },
  { displayName: "LinkedIn Premium", category: "software", aliases: ["linkedinpremium"] },
  { displayName: "Patreon", category: "other", aliases: ["patreon"] },
  { displayName: "Substack", category: "news", aliases: ["substack"] },
  { displayName: "PlayStation Plus", category: "gaming", aliases: ["playstation", "playstationplus"], overlapGroup: "gaming_subscription" },
  { displayName: "Xbox Game Pass", category: "gaming", aliases: ["xbox", "xboxgamepass", "gamepass"], overlapGroup: "gaming_subscription" },
];

export const KNOWN_MERCHANTS: Record<
  string,
  { displayName: string; category: Subscription["category"]; overlapGroup?: OverlapGroup }
> = Object.fromEntries(
  CANONICAL_MERCHANTS.flatMap((merchant) =>
    merchant.aliases.map((alias) => [
      alias,
      { displayName: merchant.displayName, category: merchant.category, overlapGroup: merchant.overlapGroup },
    ]),
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

  // Deliberately NOT truncated here, even though this is the one path that
  // can produce something effectively unbounded (a raw bank/CSV
  // description) and the schema's `name` field caps at
  // MAX_SUBSCRIPTION_NAME_LENGTH: detection.ts clusters transactions by
  // this exact displayName string (`clusters.get(merchant.displayName)`).
  // Truncating it here would make two unrelated long descriptions that
  // only differ after the cutoff collide onto the same cluster key,
  // silently merging distinct purchases into one detected "subscription".
  // The length cap belongs at the point this becomes a submitted `name`
  // instead — see detectedToFormValues in review-table.tsx.
  const fallbackDisplayName = titleCase(stripped) || raw.trim();
  return { displayName: fallbackDisplayName, category: "other", isKnownSubscriptionMerchant: false };
}

// A known-merchant substring search over a full free-typed sentence
// ("Spotify Premium $9.99/mo, renews the 5th") — deliberately NOT
// normalizeMerchant() above, which is tuned for a terse bank/CSV
// descriptor (processor-prefix stripping, edit-distance fuzzy fallback
// against the *whole* cleaned string). Embedded inside a full sentence,
// that algorithm has no reliable way to isolate which token is the
// merchant name; a substring search for a known alias inside the whole
// normalized text is the correct, simpler tool for this shape of input.
//
// The single source of truth both quick-add code paths (demo-provider.ts's
// keyword parser and anthropic-provider.ts's LLM extraction) use to decide
// category for a curated merchant — before this was consolidated here,
// only the demo path consulted KNOWN_MERCHANTS at all; the real
// AI-configured path asked the model to guess a category from the enum
// with no merchant grounding, which is why "Spotify Premium" typed into
// quick-add could come back "Software" instead of "Streaming" the moment a
// real ANTHROPIC_API_KEY was configured — the exact same input already
// classified correctly through CSV import and the keyless demo parser.
// Real curated data always wins; a caller falls back to its own
// keyword/LLM guess only when this returns null.
//
// >= 4 chars only, longest-alias-first — same reasoning
// stripPaymentProcessorNoise's own fuzzy gate uses: a short alias like
// "max" is a real merchant but too short to safely substring-match inside
// an arbitrary sentence ("my max budget this month" would otherwise
// false-positive as HBO Max).
const KNOWN_MERCHANT_ALIASES_BY_LENGTH = Object.keys(KNOWN_MERCHANTS)
  .filter((alias) => alias.length >= 4)
  .sort((a, b) => b.length - a.length);

export function matchKnownMerchantInText(
  freeText: string,
): { displayName: string; category: Subscription["category"]; overlapGroup?: OverlapGroup } | null {
  const normalizedText = normalizeName(freeText);
  const matchedAlias = KNOWN_MERCHANT_ALIASES_BY_LENGTH.find((alias) => normalizedText.includes(alias));
  return matchedAlias ? KNOWN_MERCHANTS[matchedAlias] : null;
}

// Resolves a *subscription's own* (already clean, user-typed or
// import-derived) name to its functional-overlap group, reusing the same
// matcher as quick-add's category correction above — a subscription name
// ("Netflix", "Adobe Creative Cloud") is exactly the free-text shape that
// function is built for. Returns null both when the merchant isn't known at
// all and when it's known but has no assigned group (most merchants) — a
// caller can't distinguish those two cases from this alone, which is
// intentional: either way, there's no group evidence to act on.
export function resolveOverlapGroup(name: string): { group: OverlapGroup; label: string } | null {
  const match = matchKnownMerchantInText(name);
  if (!match?.overlapGroup) return null;
  return { group: match.overlapGroup, label: OVERLAP_GROUP_LABELS[match.overlapGroup] };
}
