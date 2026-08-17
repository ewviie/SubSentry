import { describe, it, expect } from "vitest";
import { normalizeMerchant, matchKnownMerchantInText } from "./merchant-normalizer";

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
});
