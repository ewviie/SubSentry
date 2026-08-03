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
    // "Peacock" and "spotify" are both 7 characters — same length, but not
    // remotely similar text — guards against an overly loose fuzzy
    // threshold matching on length alone.
    const result = normalizeMerchant("Peacock");
    expect(result.isKnownSubscriptionMerchant).toBe(false);
    expect(result.displayName).toBe("Peacock");
    expect(result.category).toBe("other");
  });
});
