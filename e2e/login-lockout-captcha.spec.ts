import { test, expect, type Page } from "@playwright/test";
import { uniqueEmail, deleteTestUser, closeDb } from "./helpers/db";
import { apiFetch } from "./helpers/api";

test.afterAll(async () => {
  await closeDb();
});

// This suite runs with Cloudflare's official "always passes" Turnstile test
// keys configured (see playwright.config.ts's webServer.env and
// captcha.spec.ts's own comment) — CAPTCHA is genuinely active for the
// whole E2E run, so login/route.ts's isCaptchaConfigured() gate is
// exercised for real here (any non-empty captchaToken is accepted by
// Cloudflare's siteverify, same as every other CAPTCHA-gated E2E test in
// this suite), not skipped.
//
// Each call here sets its own X-Forwarded-For rather than using the shared
// apiFetch helper (which doesn't support custom headers) — not to exercise
// the client-ip fix itself (that's unit-tested directly in
// client-ip.test.ts), but so this test's own request volume against one
// email doesn't trip the separate ip+email rate limiter (5/15min, keyed
// tighter than this test's ~7 requests) and produce a false pass/fail on an
// unrelated control. The per-email limiter (20/hour, IP-independent) still
// applies regardless and is nowhere near tripped by this test.
async function loginAttempt(
  page: Page,
  fakeIp: string,
  body: { email: string; password: string; captchaToken?: string },
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ fakeIp, body }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": fakeIp },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, body: json };
    },
    { fakeIp, body },
  );
}

test.describe("login lockout cannot be weaponized without solving a CAPTCHA", () => {
  test("repeated failed logins are gated behind CAPTCHA once they compound, without letting an unsolved attempt count toward a fresh lock", async ({
    page,
  }) => {
    const email = uniqueEmail("e2e-lockout-captcha");
    const password = "a-real-password-123";

    // apiFetch/loginAttempt run fetch() inside the page's own context with a
    // relative URL — needs a real navigation first so that URL has an
    // origin to resolve against (same reasoning as captcha.spec.ts's own
    // page.goto before its first apiFetch call).
    await page.goto("/login");

    const signup = await apiFetch(page, "/api/auth/signup", {
      method: "POST",
      body: { email, password, captchaToken: "any-non-empty-token" },
    });
    expect(signup.status).toBe(200);

    // Signup auto-creates a session (see signup/route.ts) — this test
    // attacks the login endpoint itself, not the session signup already
    // granted.
    await apiFetch(page, "/api/auth/logout", { method: "POST" });

    // First two failed attempts: below shouldRequireCaptcha's threshold
    // (2+ prior failures) — no CAPTCHA required, same as before this fix.
    for (let i = 0; i < 2; i++) {
      const attempt = await loginAttempt(page, `10.20.30.${i + 1}`, { email, password: "wrong-password" });
      expect(attempt.status).toBe(401);
      expect(attempt.body).toMatchObject({ error: "invalid_credentials" });
    }

    // Third attempt onward: gated behind CAPTCHA. The actual regression
    // this test exists for — repeat this several times with no token and
    // confirm it never progresses toward re-locking the account (proving
    // recordFailedLogin genuinely never runs on this path).
    for (let i = 0; i < 3; i++) {
      const gated = await loginAttempt(page, `10.20.30.${i + 10}`, { email, password: "wrong-password" });
      expect(gated.status).toBe(400);
      expect(gated.body).toMatchObject({ error: "captcha_required" });
    }

    // A real (dummy-accepted) CAPTCHA token lets a wrong-password attempt
    // through to its normal outcome — the gate blocks unverified retries,
    // not ones that actually pass the check.
    const withCaptcha = await loginAttempt(page, "10.20.30.50", {
      email,
      password: "wrong-password",
      captchaToken: "any-non-empty-token",
    });
    expect(withCaptcha.status).toBe(401);
    expect(withCaptcha.body).toMatchObject({ error: "invalid_credentials" });

    // The account owner can still log in with their real password once
    // they pass the same CAPTCHA check — this fix gates progress, it
    // doesn't turn into a permanent lockout for a legitimate user either.
    const realLogin = await loginAttempt(page, "10.20.30.51", {
      email,
      password,
      captchaToken: "any-non-empty-token",
    });
    expect(realLogin.status).toBe(200);

    await deleteTestUser(email);
  });
});
