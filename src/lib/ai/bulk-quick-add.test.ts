import { describe, it, expect, vi, beforeEach } from "vitest";
import { splitQuickAddLines, runBulkQuickAdd, type BulkQuickAddLineOk } from "./bulk-quick-add";
import { MAX_BULK_QUICK_ADD_LINES } from "@/lib/subscriptions/validation";
import type { QuickAddResult } from "./parse-subscription";

// bulk-quick-add.ts calls the real quickAddSubscription/checkQuickAddRateLimit
// unless mocked — both hit an external API or shared in-memory state, so
// every test below controls them directly rather than depending on whether
// ANTHROPIC_API_KEY happens to be set in this environment. quickAddLineSchema
// stays real (importOriginal) since bulk-quick-add.ts's own per-line schema
// gate depends on it.
const { quickAddSubscriptionMock } = vi.hoisted(() => ({ quickAddSubscriptionMock: vi.fn() }));
vi.mock("./parse-subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse-subscription")>();
  return { ...actual, quickAddSubscription: quickAddSubscriptionMock };
});

const { checkQuickAddRateLimitMock } = vi.hoisted(() => ({ checkQuickAddRateLimitMock: vi.fn() }));
vi.mock("./rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rate-limit")>();
  return { ...actual, checkQuickAddRateLimit: checkQuickAddRateLimitMock };
});

function okResult(name: string): QuickAddResult {
  return {
    ok: true,
    subscription: {
      name,
      amount: "9.99",
      currency: "usd",
      billingCycle: "monthly",
      category: "other",
      nextRenewalDate: "2099-01-01",
      status: "active",
    },
    confidence: "high",
  };
}

describe("splitQuickAddLines", () => {
  it("splits on newlines, trims, and drops blank lines", () => {
    expect(splitQuickAddLines("Netflix $15.99/mo\n\n  Spotify $9.99/mo  \n\n\niCloud $2.99/mo")).toEqual([
      "Netflix $15.99/mo",
      "Spotify $9.99/mo",
      "iCloud $2.99/mo",
    ]);
  });

  it("strips CRLF line endings", () => {
    expect(splitQuickAddLines("Netflix $15.99/mo\r\nSpotify $9.99/mo\r\n")).toEqual(["Netflix $15.99/mo", "Spotify $9.99/mo"]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(splitQuickAddLines("   \n\n  \n")).toEqual([]);
  });
});

describe("runBulkQuickAdd", () => {
  beforeEach(() => {
    quickAddSubscriptionMock.mockReset();
    checkQuickAddRateLimitMock.mockReset();
    checkQuickAddRateLimitMock.mockResolvedValue({ allowed: true, remaining: 39 });
  });

  it("parses every line, preserving original order and 1-based line numbers", async () => {
    quickAddSubscriptionMock.mockImplementation(async (text: string) => okResult(text.split(" ")[0]));

    const { results, omittedLineCount } = await runBulkQuickAdd(
      "user-1",
      "free",
      "Netflix $15.99/mo\nSpotify $9.99/mo\niCloud $2.99/mo",
    );

    expect(omittedLineCount).toBe(0);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.line)).toEqual([1, 2, 3]);
    expect(results.every((r): r is BulkQuickAddLineOk => r.ok)).toBe(true);
    expect((results as BulkQuickAddLineOk[]).map((r) => r.subscription.name)).toEqual(["Netflix", "Spotify", "iCloud"]);
  });

  it("2. reports mixed valid and invalid lines honestly, without silently dropping or guessing", async () => {
    quickAddSubscriptionMock.mockImplementation(async (text: string) =>
      text.startsWith("Bad")
        ? { ok: false, error: "Couldn't quite understand that. Try rephrasing, or enter it manually below." }
        : okResult(text.split(" ")[0]),
    );

    const { results } = await runBulkQuickAdd("user-1", "free", "Netflix $15.99/mo\nBad line with no real subscription\nSpotify $9.99/mo");

    expect(results[0]).toMatchObject({ ok: true, line: 1 });
    expect(results[1]).toMatchObject({ ok: false, line: 2, error: expect.stringContaining("understand") });
    expect(results[2]).toMatchObject({ ok: true, line: 3 });
  });

  it("rejects a too-short line via the same per-line schema a single quick-add uses, without ever calling the parser", async () => {
    quickAddSubscriptionMock.mockResolvedValue(okResult("Should not be called"));

    const { results } = await runBulkQuickAdd("user-1", "free", "Netflix $15.99/mo\nhi");

    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, line: 2, rawText: "hi" });
    expect(quickAddSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(quickAddSubscriptionMock).toHaveBeenCalledWith("Netflix $15.99/mo");
  });

  it("rejects an over-280-character line the same way, without calling the parser", async () => {
    quickAddSubscriptionMock.mockResolvedValue(okResult("Netflix"));
    const tooLong = "x".repeat(281);
    const { results } = await runBulkQuickAdd("user-1", "free", `Netflix $15.99/mo\n${tooLong}`);

    expect(results[1]).toMatchObject({ ok: false, line: 2 });
    expect(quickAddSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("caps at MAX_BULK_QUICK_ADD_LINES and reports the omitted count honestly, never silently", async () => {
    quickAddSubscriptionMock.mockImplementation(async (text: string) => okResult(text));
    const lines = Array.from({ length: MAX_BULK_QUICK_ADD_LINES + 7 }, (_, i) => `Service ${i} $9.99/mo`);

    const { results, omittedLineCount } = await runBulkQuickAdd("user-1", "free", lines.join("\n"));

    expect(results).toHaveLength(MAX_BULK_QUICK_ADD_LINES);
    expect(omittedLineCount).toBe(7);
    expect(quickAddSubscriptionMock).toHaveBeenCalledTimes(MAX_BULK_QUICK_ADD_LINES);
  });

  it("stops attempting the parser once the AI quota runs out mid-batch, marking the rest rateLimited without calling it further", async () => {
    let allowedCalls = 0;
    checkQuickAddRateLimitMock.mockImplementation(async () => {
      allowedCalls += 1;
      return allowedCalls <= 2 ? { allowed: true, remaining: 0 } : { allowed: false, remaining: 0 };
    });
    quickAddSubscriptionMock.mockImplementation(async (text: string) => okResult(text));

    const { results } = await runBulkQuickAdd("user-1", "free", "Netflix $15.99/mo\nSpotify $9.99/mo\niCloud $2.99/mo\nHulu $7.99/mo");

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    expect(results[2]).toMatchObject({ ok: false, line: 3, rateLimited: true });
    expect(results[3]).toMatchObject({ ok: false, line: 4, rateLimited: true });
    expect(quickAddSubscriptionMock).toHaveBeenCalledTimes(2);
  });

  it("a schema-rejected line never consumes the AI-quota budget", async () => {
    quickAddSubscriptionMock.mockImplementation(async (text: string) => okResult(text));

    await runBulkQuickAdd("user-1", "free", "Netflix $15.99/mo\nhi\nSpotify $9.99/mo");

    // Only the two valid lines should have reserved quota — the too-short
    // "hi" line is rejected before ever reaching checkQuickAddRateLimit.
    expect(checkQuickAddRateLimitMock).toHaveBeenCalledTimes(2);
  });
});
