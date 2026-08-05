import { describe, it, expect, afterEach, vi } from "vitest";
import { buildCsp } from "./proxy";

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
