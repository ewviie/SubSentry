import { test, expect } from "@playwright/test";
import { uniqueEmail, deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Email verification is disabled in the active signup flow — CAPTCHA + rate
// limiting + lockout are the bot/abuse protection instead (see
// api/auth/signup/route.ts). The underlying verification implementation
// (token issuance, /api/auth/verify-email, /api/auth/resend-verification)
// is kept intact and isolated for a future re-enable; the "an
// invalid-looking token" case below still exercises /verify-email directly
// to confirm that dormant code path hasn't bit-rotted, without depending on
// signup ever producing an unverified user to test the valid-token case
// against.
test.describe("signup", () => {
  test("valid signup logs the user in immediately and lands on the dashboard", async ({ page }) => {
    const email = uniqueEmail("e2e-signup");
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("a-strong-password-123");
    // Required consent checkbox (see signup-form.tsx) — submit stays
    // disabled without it.
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 5000 });

    await deleteTestUser(email);
  });

  test("rejects a password under 8 characters client-side", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(uniqueEmail("e2e-weak"));
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("short");
    // minLength=8 is a real HTML attribute on this field (see
    // password-field.tsx) — the browser blocks submission before any
    // network request fires, which :invalid lets us assert directly.
    await expect(password).toHaveJSProperty("validity.valid", false);
  });

  // Regression coverage for the Product Polish pass's #3 fix: signup used
  // to show three separate Terms/Privacy touchpoints on one screen (the AI
  // disclosure line, the consent checkbox, and this standalone footer nav).
  // The footer nav is gone from signup specifically — the consent
  // checkbox's own Terms/Privacy links (still present, still required) are
  // enough on that page — but stays everywhere else in the auth layout,
  // which has no other way to reach the policies.
  test("does not show the standalone legal footer nav (the consent checkbox already links Terms/Privacy)", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("navigation", { name: "Legal" })).toHaveCount(0);
    // The actual required consent language must still be present.
    await expect(page.getByText("I agree to the")).toBeVisible();
  });
});

test.describe("auth layout legal footer — kept on every other auth page", () => {
  for (const path of ["/login", "/forgot-password"]) {
    test(`${path} still shows the standalone Terms/Privacy nav`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Legal" })).toBeVisible();
    });
  }
});

test.describe("email verification (dormant, kept for a future re-enable)", () => {
  test("an invalid/expired-looking token shows a clear error, not a crash", async ({ page }) => {
    await page.goto("/verify-email?token=this-token-was-never-issued");
    await expect(page.getByText("Verification failed")).toBeVisible();
  });
});

test.describe("login failures", () => {
  test("wrong password shows a generic error and does not redirect", async ({ page }) => {
    // A fresh, never-seen-before email each run, not a fixed string — the
    // DB-backed lockout (src/lib/auth/lockout.ts) tracks failed attempts
    // *per email* with no built-in test reset, so a hardcoded address
    // reused across repeated local runs eventually trips the real 5-attempt
    // lockout and this test starts seeing "account_locked" instead of
    // "invalid_credentials" — a sign the lockout is working, not a bug.
    await page.goto("/login");
    await page.getByLabel("Email").fill(uniqueEmail("e2e-wrong-password"));
    await page.getByLabel("Password", { exact: true }).fill("whatever-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("route protection", () => {
  test("an unauthenticated visitor hitting /dashboard is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unauthenticated visitor hitting /settings is redirected to /login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });
});

// The literal price/feature strings here mirror lib/billing/pro-features.ts
// (the single source of truth pricing-section.tsx, Settings → Plan &
// Billing, and login-pro-teaser.tsx all import from) rather than importing
// it directly — no other spec in this suite imports app source into a test
// file, Playwright config here doesn't resolve the `@/` alias, and a plain
// page-content assertion is exactly what every other spec in this file
// already does for real UI copy. If this ever drifts from pro-features.ts,
// that module's own unit test (pro-features.test.ts) is what actually
// pins the canonical values; this test's job is only "the login page
// renders what that module currently says," not re-verifying the module
// itself.
test.describe("login page — Pro messaging", () => {
  test("shows the real Pro price and full feature list without disturbing the login form", async ({ page }) => {
    await page.goto("/login");

    // The login form itself stays exactly as it was — this is the one
    // guard that a Pro teaser added below it never quietly turned into a
    // login-page redesign.
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

    // The Pro teaser: real price, real feature list, no invented ones.
    await expect(page.getByText("SubSentry Pro")).toBeVisible();
    await expect(page.getByText("£4.99")).toBeVisible();
    for (const feature of [
      "Unlimited active subscriptions",
      "Full Health Score across all 5 factors",
      "Every savings opportunity",
      "Optimization recommendations",
      "AI quick-add — 40/day",
      "Priority support",
    ]) {
      await expect(page.getByText(feature)).toBeVisible();
    }

    // No fake urgency/scarcity/countdown language.
    for (const darkPattern of [/limited spots/i, /act now/i, /hurry/i, /offer ends/i, /\d+:\d{2}:\d{2}/]) {
      await expect(page.getByText(darkPattern)).toHaveCount(0);
    }
  });
});
