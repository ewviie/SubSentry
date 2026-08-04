import { describe, it, expect } from "vitest";
import { normalizeMerchant } from "./merchant-normalizer";

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
