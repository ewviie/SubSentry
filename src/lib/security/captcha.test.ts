import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCaptchaConfigured, verifyCaptchaToken } from "./captcha";

const ENV_KEY = "TURNSTILE_SECRET_KEY";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
  vi.unstubAllGlobals();
});

describe("isCaptchaConfigured", () => {
  it("is false when TURNSTILE_SECRET_KEY is unset", () => {
    delete process.env[ENV_KEY];
    expect(isCaptchaConfigured()).toBe(false);
  });

  it("is true when TURNSTILE_SECRET_KEY is set", () => {
    process.env[ENV_KEY] = "test-secret";
    expect(isCaptchaConfigured()).toBe(true);
  });
});

describe("verifyCaptchaToken", () => {
  beforeEach(() => {
    process.env[ENV_KEY] = "test-secret";
  });

  it("rejects a missing (undefined) token without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyCaptchaToken(undefined, "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "missing_token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a null token without calling the network (the widget's unsolved state, sent as literal null over JSON)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyCaptchaToken(null, "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "missing_token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty-string token without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyCaptchaToken("   ", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "missing_token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when Cloudflare returns success:false (invalid/expired/already-spent token)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
      }),
    );
    const result = await verifyCaptchaToken("garbage-token", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("accepts when Cloudflare returns success:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, hostname: "example.com", challenge_ts: "2026-01-01T00:00:00Z" }),
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the returned hostname doesn't match the expected one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, hostname: "attacker.example" }),
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4", { expectedHostname: "subsentry.app" });
    expect(result).toEqual({ ok: false, reason: "hostname_mismatch" });
  });

  it("does not enforce hostname when expectedHostname isn't provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, hostname: "anything.example" }),
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the returned action doesn't match the expected one (a signup-solved token replayed against resend-verification)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, action: "signup" }),
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4", { expectedAction: "resend_verification" });
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("accepts when the returned action matches the expected one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, action: "signup" }),
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4", { expectedAction: "signup" });
    expect(result).toEqual({ ok: true });
  });

  it("does not enforce action when expectedAction isn't provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, action: "anything" }),
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: true });
  });

  it("fails closed on a network error (fetch throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "verify_request_failed" });
  });

  it("fails closed on a timeout (abort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")));
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "verify_request_failed" });
  });

  it("fails closed on a non-OK HTTP status from Cloudflare", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => null }));
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "verify_request_failed" });
  });

  it("fails closed on a malformed (non-JSON) response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "verify_request_failed" });
  });

  it("fails closed if somehow called while unconfigured (defense in depth, not the normal call path)", async () => {
    delete process.env[ENV_KEY];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyCaptchaToken("real-token", "1.2.3.4");
    expect(result).toEqual({ ok: false, reason: "verify_request_failed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
