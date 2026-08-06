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
