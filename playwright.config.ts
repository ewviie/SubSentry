import { defineConfig, devices } from "@playwright/test";

// Critical-path E2E smoke coverage — not an exhaustive UI suite. Scoped to
// the journeys with real security/business consequence (auth flow,
// protected-route gating, IDOR-via-URL, invalid-form handling) rather than
// every listed journey in the production-readiness checklist, given this
// repo had zero browser-level tests before this. See
// PRODUCTION_READINESS_REPORT.md for what's covered vs. explicitly deferred.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shares one Postgres dev DB — see vitest.config.ts's identical reasoning
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    // Cloudflare's own publicly documented Turnstile test keys
    // (https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
    // — not secrets, safe to commit. The "always passes" pair makes every
    // existing signup/resend-verification E2E test exercise the real
    // CAPTCHA integration end-to-end (script load under the real CSP,
    // widget render, token round-trip to Cloudflare's actual siteverify
    // API) instead of skipping it — verified manually before wiring this
    // in that the dummy widget auto-solves instantly with no visual
    // challenge, so this doesn't add flakiness or meaningfully slow any
    // existing test. e2e/captcha.spec.ts's bypass-prevention tests rely on
    // CAPTCHA actually being configured here — without this, those tests
    // would silently pass for the wrong reason (the check being skipped
    // entirely, not enforced and satisfied).
    env: {
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    },
  },
});
