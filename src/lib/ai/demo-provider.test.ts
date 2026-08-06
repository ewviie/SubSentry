import { describe, it, expect } from "vitest";
import { DemoProvider } from "./demo-provider";

const provider = new DemoProvider();

describe("DemoProvider.parseSubscriptionText — category inference", () => {
  // The reported bug: "Apple Music" fell through to "other" because the
  // old CATEGORY_KEYWORDS list (streaming: netflix/spotify/disney/hulu/
  // hbo/prime video/youtube) never included it — a smaller, separate list
  // than the one already maintained for CSV/bank imports.
  it("recognizes Apple Music as streaming, not the generic Apple->software entry", async () => {
    const result = await provider.parseSubscriptionText("Apple Music $10.99/mo");
    expect(result.category).toBe("streaming");
  });

  it("still categorizes a bare Apple charge as software (ambiguous without a specific service name)", async () => {
    const result = await provider.parseSubscriptionText("Apple $2.99/mo");
    expect(result.category).toBe("software");
  });

  it("recognizes merchants only present in the shared KNOWN_MERCHANTS table (not the old local keyword list)", async () => {
    expect((await provider.parseSubscriptionText("Paramount+ $5.99/mo")).category).toBe("streaming");
    expect((await provider.parseSubscriptionText("1Password $2.99/mo")).category).toBe("software");
    expect((await provider.parseSubscriptionText("PlayStation Plus $9.99/mo")).category).toBe("gaming");
  });

  it("still recognizes merchants from the original keyword list", async () => {
    expect((await provider.parseSubscriptionText("Netflix $15.99/mo")).category).toBe("streaming");
    expect((await provider.parseSubscriptionText("Spotify $10.99/mo")).category).toBe("streaming");
    expect((await provider.parseSubscriptionText("Adobe Creative Cloud $54.99/mo")).category).toBe(
      "software",
    );
  });

  it("falls back to the generic keyword list for services absent from KNOWN_MERCHANTS", async () => {
    expect((await provider.parseSubscriptionText("Local Gym $40/mo")).category).toBe("fitness");
  });

  // Never guesses — "other" is the honest answer when nothing matches,
  // not silently replaced with a wrong category.
  it("falls back to other for a genuinely unrecognized service, rather than guessing", async () => {
    const result = await provider.parseSubscriptionText("Local Plumber Membership $19.99/mo");
    expect(result.category).toBe("other");
  });

  // A short known alias ("max", HBO's rebrand — 3 chars) must not
  // substring-match inside unrelated free text the way a longer, more
  // specific alias safely can.
  it("does not let a short merchant alias false-positive inside unrelated text", async () => {
    const result = await provider.parseSubscriptionText("My max budget subscription $9.99/mo");
    expect(result.category).toBe("other");
  });
});
