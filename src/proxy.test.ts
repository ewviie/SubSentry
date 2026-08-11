import { describe, it, expect, afterEach, vi } from "vitest";
import { buildCsp, resolveRequestId, isProtectedPath } from "./proxy";

// CSP correctness is security-sensitive and easy to silently regress with
// no visible error (a browser only logs a CSP violation to a console
// nobody's watching) — see proxy.ts's own comment on why buildCsp is
// exported for this file to exist at all.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCsp", () => {
  it("includes the given nonce in script-src", () => {
    const csp = buildCsp("test-nonce-123");
    expect(csp).toContain("'nonce-test-nonce-123'");
  });

  it("allows Cloudflare Turnstile's script origin (bot protection on signup/resend-verification)", () => {
    const csp = buildCsp("n");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("https://challenges.cloudflare.com");
  });

  it("allows Cloudflare Turnstile's challenge iframe via frame-src", () => {
    const csp = buildCsp("n");
    const frameSrc = csp.split(";").find((d) => d.trim().startsWith("frame-src"));
    expect(frameSrc).toBeDefined();
    expect(frameSrc).toContain("https://challenges.cloudflare.com");
  });

  it("allows the Turnstile widget's own network calls via connect-src", () => {
    const csp = buildCsp("n");
    const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
    expect(connectSrc).toContain("https://challenges.cloudflare.com");
  });

  it("does not widen frame-ancestors, object-src, or default-src beyond 'self'/'none' — Turnstile only touches script/frame/connect-src", () => {
    const csp = buildCsp("n");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("production build omits 'unsafe-eval' from script-src", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = buildCsp("n");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("dev build includes 'unsafe-eval' (React dev-mode debugging requires it)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = buildCsp("n");
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("unsafe-eval");
  });
});

describe("resolveRequestId", () => {
  it("preserves an inbound id shaped like a real upstream-proxy request id", () => {
    expect(resolveRequestId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("mints a fresh id when there's no inbound header", () => {
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  // A caller-controlled request id is both logged (logServerError /
  // logSecurityEvent) and echoed back in a response header — accepting an
  // arbitrary string here would let any caller plant fake correlation ids
  // in this app's own logs.
  it("rejects an oversized inbound id rather than reflecting it into logs/response headers", () => {
    const huge = "a".repeat(500);
    expect(resolveRequestId(huge)).not.toBe(huge);
  });

  it("rejects an inbound id containing characters outside the safe token set", () => {
    const malicious = "id\r\nX-Injected: evil";
    expect(resolveRequestId(malicious)).not.toBe(malicious);
  });
});

describe("isProtectedPath", () => {
  it("matches a protected route exactly and its sub-paths", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/dashboard/")).toBe(true);
    expect(isProtectedPath("/subscriptions/abc-123")).toBe(true);
    expect(isProtectedPath("/settings")).toBe(true);
  });

  // The actual bug this test exists for: a real public asset
  // (dashboard-screenshot.jpg, added for the landing page's features
  // section) was getting 307-redirected to /login because the old
  // startsWith("/dashboard") check treated any path merely beginning with
  // that string as protected.
  it("does not match a public path that only shares a text prefix with a protected route", () => {
    expect(isProtectedPath("/dashboard-screenshot.jpg")).toBe(false);
    expect(isProtectedPath("/settings-page-marketing-copy")).toBe(false);
    expect(isProtectedPath("/savingsaccountguide")).toBe(false);
  });

  it("does not match an unrelated public path", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/logo-mark.png")).toBe(false);
  });
});
