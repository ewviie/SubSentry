import { describe, it, expect } from "vitest";
import { normalizeMerchant, matchKnownMerchantInText, resolveOverlapGroup } from "./merchant-normalizer";

describe("normalizeMerchant", () => {
  it.each([
    ["NETFLIX", "Netflix", "streaming"],
    ["NETFLIX.COM", "Netflix", "streaming"],
    ["NETFLIX.COM AMSTERDAM", "Netflix", "streaming"],
    ["Netflix", "Netflix", "streaming"],
    ["SPOTIFY", "Spotify", "streaming"],
    ["Disney+", "Disney+", "streaming"],
    ["ADOBE.COM", "Adobe", "software"],
    ["APPLE.COM", "Apple", "software"],
    ["GOOGLE.COM", "Google", "software"],
    ["AMAZON.COM", "Amazon", "other"],
    ["MICROSOFT.COM", "Microsoft", "software"],
    ["DROPBOX.COM", "Dropbox", "software"],
    ["CANVA.COM", "Canva", "software"],
    ["CHATGPT", "ChatGPT", "software"],
    ["OPENAI", "ChatGPT", "software"],
    ["CLAUDE", "Claude", "software"],
    ["ANTHROPIC", "Claude", "software"],
    ["GITHUB.COM", "GitHub", "software"],
  ] as const)("resolves %s to %s / %s", (raw, expectedName, expectedCategory) => {
    const result = normalizeMerchant(raw);
    expect(result.displayName).toBe(expectedName);
    expect(result.category).toBe(expectedCategory);
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("strips a Square-style payment processor prefix", () => {
    const result = normalizeMerchant("SQ *SPOTIFY");
    expect(result.displayName).toBe("Spotify");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("strips a spaced payment processor prefix and a trailing code suffix", () => {
    const result = normalizeMerchant("SP * ADOBE INC");
    expect(result.displayName).toBe("Adobe");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("falls back to a title-cased cleaned string for an unknown merchant", () => {
    const result = normalizeMerchant("Joe's Coffee Shop 415-555-0123");
    expect(result.displayName).toBe("Joe's Coffee Shop");
    expect(result.category).toBe("other");
    expect(result.isKnownSubscriptionMerchant).toBe(false);
  });

  // The fallback path (unlike every known-merchant branch, which returns a
  // short curated displayName) can return an effectively unbounded string
  // straight from the source description — deliberately NOT truncated
  // here, since detection.ts clusters transactions by this exact string;
  // truncating it here would make two unrelated long descriptions that
  // only differ after the cutoff collide onto the same cluster key. The
  // length cap is applied downstream, only once this becomes a submitted
  // subscription name (see review-table.tsx's detectedToFormValues).
  it("does not truncate an unknown merchant's fallback display name", () => {
    const longDescription = "A".repeat(200);
    const result = normalizeMerchant(longDescription);
    expect(result.displayName.length).toBe(200);
  });

  it("does not fuzzy-match an unrelated merchant of similar length to a known one", () => {
    // "Costco" and "google"/"notion" are all 6 characters — same length,
    // but not remotely similar text — guards against an overly loose fuzzy
    // threshold matching on length alone.
    const result = normalizeMerchant("Costco");
    expect(result.isKnownSubscriptionMerchant).toBe(false);
    expect(result.displayName).toBe("Costco");
    expect(result.category).toBe("other");
  });

  it.each([
    ["YOUTUBE PREMIUM", "YouTube Premium", "streaming"],
    ["YOUTUBETV", "YouTube TV", "streaming"],
    ["PARAMOUNT+", "Paramount+", "streaming"],
    ["PEACOCK", "Peacock", "streaming"],
    ["DISCOVERYPLUS", "Discovery+", "streaming"],
    ["AUDIBLE.COM", "Audible", "streaming"],
    ["DAZN", "DAZN", "streaming"],
    ["1PASSWORD", "1Password", "software"],
    ["NORDVPN.COM", "NordVPN", "software"],
    ["LINKEDIN PREMIUM", "LinkedIn Premium", "software"],
    ["SUBSTACK.COM", "Substack", "news"],
    ["PATREON.COM", "Patreon", "other"],
    ["PLAYSTATION PLUS", "PlayStation Plus", "gaming"],
    ["XBOX GAME PASS", "Xbox Game Pass", "gaming"],
    ["AMZN MKTP US", "Amazon", "other"],
  ] as const)("resolves %s to %s / %s (expanded merchant table)", (raw, expectedName, expectedCategory) => {
    const result = normalizeMerchant(raw);
    expect(result.displayName).toBe(expectedName);
    expect(result.category).toBe(expectedCategory);
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  // Regression: "GYMPASS INC" (a real, common bank descriptor for this
  // corporate-wellness benefit) used to have no curated entry at all, so it
  // fell through to the fuzzy fallback and matched "gamepass" (Xbox Game
  // Pass) — "gympass" and "gamepass" are only edit-distance 2 apart. Fixed
  // by (a) adding GymPass as a real known merchant, so it now resolves via
  // an exact-key match tried long before the fuzzy fallback ever runs, and
  // (b) tightening the fuzzy fallback itself (see its own comment) so this
  // false-positive *shape* can't recur for some other unrecognized
  // merchant. Both a bare and processor-noise-bearing form are covered
  // here since the exact-match path runs on both the lightly- and
  // fully-stripped forms.
  it.each([
    ["GYMPASS INC", "GymPass", "fitness"],
    ["GYMPASS", "GymPass", "fitness"],
  ] as const)("resolves %s to %s / %s, not the unrelated Xbox Game Pass", (raw, expectedName, expectedCategory) => {
    const result = normalizeMerchant(raw);
    expect(result.displayName).toBe(expectedName);
    expect(result.category).toBe(expectedCategory);
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  // Xbox Game Pass itself must keep resolving correctly, including via its
  // bare "gamepass" alias — the exact same key GymPass used to be
  // fuzzy-mismatched against. An exact-key match is unaffected by the fuzzy
  // fallback's tightening below, so this must still pass unchanged.
  it.each([
    ["GAMEPASS", "Xbox Game Pass", "gaming"],
    ["XBOX GAME PASS", "Xbox Game Pass", "gaming"],
    ["XBOXGAMEPASS", "Xbox Game Pass", "gaming"],
  ] as const)("still resolves %s to %s / %s", (raw, expectedName, expectedCategory) => {
    const result = normalizeMerchant(raw);
    expect(result.displayName).toBe(expectedName);
    expect(result.category).toBe(expectedCategory);
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  // Regression: these are not hypothetical — scanning KNOWN_MERCHANTS for
  // any word within the old fuzzy tolerance turned up real collisions
  // beyond GymPass, confirming the bug was a general gap, not a one-off.
  // "GAMEPAD" (a game controller) used to false-positive-match "gamepass"
  // (Xbox Game Pass) the same way GymPass did; "NOTATION" used to
  // false-positive-match "notion" (Notion). Both are the identical shape:
  // edit-distance 2 from a known alias, reached only by combining a
  // substitution with a length change, never a same-length typo.
  it.each([
    ["GAMEPAD", "Xbox Game Pass"],
    ["NOTATION", "Notion"],
  ] as const)("does not fuzzy-match the unrelated word %s against %s", (raw, _unrelatedTarget) => {
    const result = normalizeMerchant(raw);
    expect(result.isKnownSubscriptionMerchant).toBe(false);
  });

  // The fuzzy fallback must still catch a genuine same-length typo — this
  // is the case FUZZY_MAX_DISTANCE exists for, and the fix above only
  // tightens the tolerance for candidates whose length differs, not this
  // one. "NETFILX" is "netflix" with two adjacent letters transposed, which
  // plain (non-Damerau) Levenshtein always scores as 2 substitutions with
  // no length change.
  it("still fuzzy-matches a genuine same-length typo", () => {
    const result = normalizeMerchant("NETFILX");
    expect(result.displayName).toBe("Netflix");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("strips Google Play's own billing-descriptor prefix", () => {
    const result = normalizeMerchant("GOOGLE *NETFLIX");
    expect(result.displayName).toBe("Netflix");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("does not strip a bare GOOGLE charge with no passthrough merchant (a direct Google One charge)", () => {
    const result = normalizeMerchant("GOOGLE ONE");
    expect(result.displayName).toBe("Google One");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("strips Apple's abbreviated billing-descriptor prefix", () => {
    const result = normalizeMerchant("APL*ITUNES.COM/BILL");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("resolves Apple's full billing-descriptor format without a processor prefix", () => {
    const result = normalizeMerchant("APPLE.COM/BILL");
    expect(result.displayName).toBe("Apple");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("resolves a merchant name ending in a word that looks like a trailing country code", () => {
    // "MAX" is exactly the shape stripPaymentProcessorNoise's trailing-code
    // regex targets (2-3 uppercase letters after whitespace) — HBO MAX must
    // resolve to HBO Max, not get mangled down to just "HBO" by the
    // aggressive stripping stage running before a match is attempted.
    const result = normalizeMerchant("HBO MAX");
    expect(result.displayName).toBe("HBO Max");
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("still strips a genuine trailing country code that isn't also a known product word", () => {
    const result = normalizeMerchant("Local Bistro NLD");
    expect(result.displayName).toBe("Local Bistro");
    expect(result.isKnownSubscriptionMerchant).toBe(false);
  });

  it("does not fuzzy-match a short unrelated word against a short known-merchant key", () => {
    // "Max" is a real known merchant (3 chars) but only reachable via exact
    // or substring match, never fuzzy — otherwise an edit-distance-2
    // tolerance would swallow almost any 1-5 character word.
    const result = normalizeMerchant("Wax");
    expect(result.isKnownSubscriptionMerchant).toBe(false);
    expect(result.displayName).toBe("Wax");
  });

  // Regression (release-review finding #6): findKnownMerchantBySubstring
  // (now findKnownMerchantByWords) used to check `key.includes(candidate)`
  // against the fully alphanumeric-squashed string, with no word-boundary
  // check at all — "SNAPPLE VENDING" squashed to "snapplevending", which
  // contains "apple" as a pure substring despite having nothing to do with
  // Apple. Checking whole, contiguous words instead means "snapple" (one
  // word) simply isn't equal to "apple", so it never matches. (CANVAS vs.
  // "canva" is the same class of bug reached through a different,
  // fuzzy-matching path — see its own dedicated test below.)
  it.each([
    ["SNAPPLE VENDING", "apple"],
    ["SLACKER RADIO", "slack"],
  ] as const)("does not false-positive match %s against the unrelated known alias %s", (raw, _alias) => {
    const result = normalizeMerchant(raw);
    expect(result.isKnownSubscriptionMerchant).toBe(false);
  });

  // Regression (release-review finding #6): KNOWN_MERCHANTS is iterated in
  // insertion order, and "apple" (Apple/software) was inserted before the
  // more specific "applemusic" (Apple Music/streaming) — a plain substring
  // check matched whichever came first in iteration order, not whichever
  // was the better match, so "APPLE MUSIC MEMBERSHIP" resolved to Apple
  // instead of Apple Music. findKnownMerchantByWords must prefer the
  // longer (more specific) matching word-span regardless of insertion
  // order, whether the two real words are typed with a space between them
  // or come pre-glued as one word (a real payment-processor descriptor
  // shape).
  it.each([
    ["APPLE MUSIC MEMBERSHIP", "Apple Music", "streaming"],
    ["APPLEMUSIC", "Apple Music", "streaming"],
  ] as const)("resolves %s to the more specific %s, not the shorter Apple alias", (raw, expectedName, expectedCategory) => {
    const result = normalizeMerchant(raw);
    expect(result.displayName).toBe(expectedName);
    expect(result.category).toBe(expectedCategory);
    expect(result.isKnownSubscriptionMerchant).toBe(true);
  });

  it("still resolves a bare Apple charge to the general Apple merchant", () => {
    const result = normalizeMerchant("APPLE.COM/BILL");
    expect(result.displayName).toBe("Apple");
    expect(result.category).toBe("software");
  });

  // Regression (release-review finding #6, second half): "CANVAS" is a
  // single whole word, so it's correctly rejected by the word-boundary fix
  // above — but it's also within edit-distance-1 of the real "canva" alias
  // (Canvas, the school LMS, is genuinely one letter longer than Canva,
  // the design tool), so the *separate* fuzzy fallback matched it anyway
  // via a plain `key.includes(candidate)`-adjacent edit-distance check with
  // no concept of "this is a whole different word, not a typo." A strict
  // prefix relationship (one string is the other plus a trailing
  // extension) is excluded from the fuzzy fallback for exactly this
  // reason, without narrowing the distance tolerance genuine mid-word
  // typos still rely on.
  it("does not fuzzy-match a longer, unrelated real word that happens to start with a known alias", () => {
    const result = normalizeMerchant("CANVAS");
    expect(result.isKnownSubscriptionMerchant).toBe(false);
    expect(result.displayName).toBe("Canvas");
  });
});

// Regression coverage for a Phase 7.2 classification bug: quick-add with a
// real ANTHROPIC_API_KEY configured could return "Spotify Premium" ->
// category "software" instead of "streaming" — the model had no grounding
// in KNOWN_MERCHANTS (unlike CSV/bank import and the keyless demo parser),
// so it guessed from the bare category enum alone. matchKnownMerchantInText
// is the shared fix both quick-add code paths now consult first.
describe("matchKnownMerchantInText", () => {
  it.each([
    ["Spotify Premium $9.99/mo", "streaming"],
    ["Netflix $15.49 monthly", "streaming"],
    ["Disney+ 7.99 a month", "streaming"],
    ["Apple Music 10.99/mo", "streaming"],
    ["YouTube Premium $13.99", "streaming"],
    ["Amazon Prime 139/yr", "other"],
    ["Adobe Creative Cloud $54.99/mo", "software"],
    ["Canva Pro 12.99 monthly", "software"],
    ["Dropbox Plus $11.99", "software"],
    ["Google One 100gb $1.99/mo", "software"],
    ["Microsoft 365 $6.99 a month", "software"],
  ] as const)("classifies %s as %s, matching CSV import's classification for the same merchant", (text, expectedCategory) => {
    expect(matchKnownMerchantInText(text)?.category).toBe(expectedCategory);
  });

  it("returns null for a genuinely unknown service, never a guessed category", () => {
    expect(matchKnownMerchantInText("My Local Yoga Studio $40/mo")).toBeNull();
  });

  it("matches embedded inside a full free-typed sentence, not just a bare merchant name", () => {
    const result = matchKnownMerchantInText("just signed up for spotify premium, renews the 5th at $10.99");
    expect(result?.displayName).toBe("Spotify");
    expect(result?.category).toBe("streaming");
  });

  // Regression: matchKnownMerchantInText used to check
  // `normalizedText.includes(alias)` against normalizeName's
  // alphanumeric-squashed text (KNOWN_MERCHANT_ALIASES_BY_LENGTH), the
  // same no-word-boundary bug findKnownMerchantByWords was built to fix
  // for the bank-import path — quick-add free text is exactly as exposed
  // to it. "my CANVAS class notes" squashed to "mycanvasclassnotes",
  // which contains "canva" as a pure substring despite having nothing to
  // do with Canva; "the SLACKER RADIO app" squashed similarly and
  // contained "slack".
  it.each([
    ["my CANVAS class notes $15/semester", "canva"],
    ["the SLACKER RADIO app is $4.99/mo", "slack"],
  ] as const)("does not false-positive match %s against the unrelated known alias %s", (text, _alias) => {
    expect(matchKnownMerchantInText(text)).toBeNull();
  });

  it("still resolves a genuine Canva subscription mentioned in free text", () => {
    const result = matchKnownMerchantInText("Canva Pro renews at $12.99/mo");
    expect(result?.displayName).toBe("Canva");
    expect(result?.category).toBe("software");
  });

  it("still resolves a genuine Slack subscription mentioned in free text", () => {
    const result = matchKnownMerchantInText("Slack subscription, $8/mo per user");
    expect(result?.displayName).toBe("Slack");
    expect(result?.category).toBe("software");
  });
});

// CodeRabbit review regression: a subscription named exactly "Max" (HBO's
// real, deliberately-short 3-char alias) used to silently lose its overlap
// group — matchKnownMerchantInText's substring matcher gates keys < 4
// chars specifically to avoid false-positive substring matches inside a
// longer sentence, a safety net that has no reason to block an *exact*
// match against a subscription's own (not free-typed) name.
describe("resolveOverlapGroup", () => {
  it("resolves an exact match against a short (< 4 char) alias like 'Max'", () => {
    expect(resolveOverlapGroup("Max")).toEqual({ group: "video_streaming", label: "Video streaming" });
  });

  it("still resolves longer names via substring matching", () => {
    expect(resolveOverlapGroup("Adobe Creative Cloud")?.group).toBe("creative_tools");
  });

  it("returns null for a merchant with no assigned overlap group", () => {
    expect(resolveOverlapGroup("Amazon Prime")).toBeNull();
  });

  it("returns null for a genuinely unknown merchant", () => {
    expect(resolveOverlapGroup("My Local Yoga Studio")).toBeNull();
  });
});
