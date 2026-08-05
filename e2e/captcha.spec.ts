import { test, expect } from "@playwright/test";
import { uniqueEmail } from "./helpers/db";
import { apiFetch } from "./helpers/api";

// This suite runs with Cloudflare's official "always passes" Turnstile
// test keys configured (see playwright.config.ts's webServer.env) — CAPTCHA
// is genuinely active for the whole E2E run, not skipped. That also means
// every existing signup/resend-verification test in auth.spec.ts now
// implicitly proves the full happy-path integration (real widget render,
// real token round-trip to Cloudflare's actual siteverify API, real
// signup success) — not duplicated here. This file only covers what isn't
// already covered: server-side enforcement that can't be bypassed by
// skipping the widget entirely and calling the API directly.
//
// What's deliberately NOT tested here: "a garbage/invalid token is
// rejected." With the *always-passes* dummy secret key configured (needed
// so the rest of the E2E suite's real signup/login flows keep working),
// Cloudflare's siteverify returns success:true for any non-empty token,
// by design — so that scenario would either pass for the wrong reason or
// require a second, differently-configured webServer just for one test.
// It's covered instead at the unit level (src/lib/security/captcha.test.ts,
// "rejects when Cloudflare returns success:false") and was independently
// verified once by hand against a real (non-mocked) Cloudflare call using
// the "always fails" dummy pair — see AUTH_BOT_PROTECTION_REPORT.md.
test.describe("CAPTCHA — server-side enforcement can't be bypassed by skipping the widget", () => {
  test("signup with no captchaToken field is rejected", async ({ page }) => {
    await page.goto("/signup");
    const { status, body } = await apiFetch(page, "/api/auth/signup", {
      method: "POST",
      body: { email: uniqueEmail("e2e-captcha-signup"), password: "a-strong-password-123" },
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "captcha_failed" });
  });

  test("signup with an empty-string captchaToken is rejected", async ({ page }) => {
    await page.goto("/signup");
    const { status, body } = await apiFetch(page, "/api/auth/signup", {
      method: "POST",
      body: { email: uniqueEmail("e2e-captcha-signup-empty"), password: "a-strong-password-123", captchaToken: "" },
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "captcha_failed" });
  });

  test("resend-verification with no captchaToken field is rejected", async ({ page }) => {
    await page.goto("/login");
    const { status, body } = await apiFetch(page, "/api/auth/resend-verification", {
      method: "POST",
      body: { email: "whoever@example.com" },
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "captcha_failed" });
  });
});
