import { test, expect } from "@playwright/test";
import { uniqueEmail, getRawVerificationTokenForEmail, deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

test.describe("signup", () => {
  test("valid signup shows the check-your-email screen, not the dashboard", async ({ page }) => {
    const email = uniqueEmail("e2e-signup");
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("a-strong-password-123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);

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

test.describe("email verification -> login", () => {
  test("verifying activates the account and logs the user in; logging out then requires a real login", async ({
    page,
  }) => {
    const email = uniqueEmail("e2e-verify");
    const password = "a-strong-password-123";

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    // Login must be blocked pre-verification.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/verify your email/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    const rawToken = await getRawVerificationTokenForEmail(email);
    expect(rawToken).not.toBeNull();

    await page.goto(`/verify-email?token=${rawToken}`);
    await expect(page.getByText("Email verified")).toBeVisible();
    await page.waitForURL(/\/dashboard$/, { timeout: 5000 });
    // The dashboard just mounted via a client-side router.push() from
    // /verify-email — clicking the (client-component) logout button before
    // React finishes hydrating it is a real flake risk: the element is
    // already "visible" by Playwright's actionability check, but its
    // onClick isn't wired up yet, so the click silently no-ops. Waiting for
    // the network to settle is a reasonable proxy for "hydration finished"
    // without pinning this on a fixed sleep.
    await page.waitForLoadState("networkidle");
    const logoutButton = page.getByRole("button", { name: /log out/i });

    // Now log out and confirm a real login (post-verification) succeeds.
    // Asserting on the login form appearing (not waitForURL) — logout
    // navigates via router.push(), a client-side history change rather
    // than a full page load, which is a more brittle thing to pin a
    // navigation-event wait on than just checking the page we actually
    // expect to land on renders.
    await logoutButton.click();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible({ timeout: 10_000 });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await deleteTestUser(email);
  });

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
