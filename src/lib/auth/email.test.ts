import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isEmailSendingConfigured, sendVerificationEmail } from "./email";

// NODE_ENV is handled separately via vi.stubEnv/unstubAllEnvs below —
// @types/node marks it read-only, so a plain `process.env.NODE_ENV = ...`
// assignment (which works fine at runtime under Vitest) fails typecheck.
const ENV_KEYS = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isEmailSendingConfigured", () => {
  it("is false when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY;
    expect(isEmailSendingConfigured()).toBe(false);
  });

  it("is true when RESEND_API_KEY is set", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(isEmailSendingConfigured()).toBe(true);
  });
});

describe("sendVerificationEmail — unconfigured (demo mode)", () => {
  it("logs the link and returns in non-production", async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws in production rather than logging a live verification link", async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv("NODE_ENV", "production");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/RESEND_API_KEY/);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("sendVerificationEmail — configured (Resend API)", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
  });

  it("succeeds on the first attempt, no retry", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("retries on a 5xx and succeeds on the second attempt", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on a network error (fetch throwing) and succeeds on a later attempt", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx — fails fast since it isn't transient", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 422 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/422/);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("throws after exhausting all retries on persistent 5xx failures", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/500/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries on persistent network errors", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("still down"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/still down/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
