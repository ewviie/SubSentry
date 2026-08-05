import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiterAsync, isDistributedRateLimitConfigured } from "./rate-limit-distributed";

const ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("isDistributedRateLimitConfigured", () => {
  it("is false when neither env var is set", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isDistributedRateLimitConfigured()).toBe(false);
  });

  it("is true only when both are set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isDistributedRateLimitConfigured()).toBe(false);

    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    expect(isDistributedRateLimitConfigured()).toBe(true);
  });
});

describe("createRateLimiterAsync — in-memory fallback (unconfigured)", () => {
  it("enforces the limit the same way the sync limiter does", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const limiter = createRateLimiterAsync(2, 60_000);
    const key = `fallback-${Math.random()}`;
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(false);
  });
});

describe("createRateLimiterAsync — Upstash path (configured)", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  it("allows a request when the pipeline INCR is under the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ result: 1 }, { result: 1 }],
      }),
    );
    const limiter = createRateLimiterAsync(5, 60_000);
    const result = await limiter("some-key");
    expect(result).toEqual({ allowed: true, remaining: 4 });
  });

  it("blocks once the pipeline INCR exceeds the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ result: 6 }, { result: 0 }],
      }),
    );
    const limiter = createRateLimiterAsync(5, 60_000);
    const result = await limiter("some-key");
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });

  it("falls back to in-memory if the Upstash request fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const limiter = createRateLimiterAsync(2, 60_000);
    const key = `upstash-down-${Math.random()}`;
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(false);
  });

  it("falls back to in-memory if Upstash responds with a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => null }));
    const limiter = createRateLimiterAsync(1, 60_000);
    const key = `upstash-500-${Math.random()}`;
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(false);
  });

  it("falls back to in-memory if Upstash returns 200 with a malformed/error pipeline body (regression: used to silently deny every request)", async () => {
    // A well-formed HTTP 200 whose body is an Upstash command error
    // (`{error: ...}`) rather than the expected `{result: number}` shape —
    // the `!response.ok` check alone can't catch this.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ error: "WRONGTYPE" }, { error: "WRONGTYPE" }] }),
    );
    const limiter = createRateLimiterAsync(2, 60_000);
    const key = `upstash-malformed-${Math.random()}`;
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(true);
    expect((await limiter(key)).allowed).toBe(false);
  });

  it("passes an abort signal to fetch so a hung Upstash request can't stall forever, and falls back if it fires", async () => {
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      // Simulates the signal firing (what AbortSignal.timeout does once its
      // deadline elapses) without actually waiting out the real timeout.
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const limiter = createRateLimiterAsync(2, 60_000);
    const key = `upstash-timeout-${Math.random()}`;
    const result = await limiter(key);
    expect(result.allowed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
