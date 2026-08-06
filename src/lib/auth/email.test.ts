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

  // A bare { ok, status } object stands in for most of these mocks; a few
  // below also need a working .json() since sendVerificationEmail now
  // always reads the response body for diagnostic logging.
  function mockResponse(ok: boolean, status: number, body: unknown = {}) {
    return { ok, status, json: () => Promise.resolve(body) };
  }

  it("succeeds on the first attempt, no retry", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(true, 200, { id: "email-id-1" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("sends the expected copy, with the verification link in both the html and text bodies", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(true, 200, { id: "email-id-2" }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendVerificationEmail("user@example.com", "raw-token");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.html).toContain("Thanks for creating a SubSentry account");
    expect(body.html).toContain("Verify email address");
    expect(body.html).toContain("Once your email has been verified");
    expect(body.text).toContain("Thanks for creating a SubSentry account");
    expect(body.html).toMatch(/href="http[^"]*\/verify-email\?token=raw-token"/);
    expect(body.text).toContain("/verify-email?token=raw-token");
  });

  // Diagnostic logging (added while chasing a real "API returns 200 but
  // nothing arrives" case, root-caused to Resend's shared resend.dev
  // sending domain silently rejecting real recipients): a 2xx from Resend
  // only means the send request was accepted into its queue, not that it
  // was actually delivered — this just confirms the id gets logged so a
  // specific send can be looked up in Resend's own dashboard later, and
  // that a rejection's exact reason (not just a status code) gets logged
  // too, rather than treating either as a black box.
  it("logs the Resend email id on a successful send", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(true, 200, { id: "email-id-3" }));
    vi.stubGlobal("fetch", fetchSpy);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendVerificationEmail("user@example.com", "raw-token");

    const logged = logSpy.mock.calls.map((c) => c[0]).find((line) => String(line).includes("email-id-3"));
    expect(logged).toBeDefined();
  });

  it("logs Resend's own rejection reason, not just a bare status code", async () => {
    const rejection = { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address" };
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(false, 403, rejection));
    vi.stubGlobal("fetch", fetchSpy);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/403/);

    const logged = errorSpy.mock.calls.map((c) => c[0]).find((line) => String(line).includes("validation_error"));
    expect(logged).toBeDefined();
  });

  it("retries on a 5xx and succeeds on the second attempt", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(false, 503))
      .mockResolvedValueOnce(mockResponse(true, 200, { id: "email-id-4" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on a network error (fetch throwing) and succeeds on a later attempt", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(mockResponse(true, 200, { id: "email-id-5" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx — fails fast since it isn't transient", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(false, 422));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendVerificationEmail("user@example.com", "raw-token")).rejects.toThrow(/422/);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("throws after exhausting all retries on persistent 5xx failures", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(false, 500));
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
