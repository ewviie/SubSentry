import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser, getRawPasswordResetTokenForEmail } from "./helpers/db";
import { apiFetch } from "./helpers/api";

// The (auth) route group's shared layout redirects an already-authenticated
// session straight to /dashboard (see src/app/(auth)/layout.tsx) — correct
// for /login and /signup, and just as correct here: a real user reaching
// for "forgot password" is, by definition, someone who can't currently log
// in, so they're not carrying a live session on the device/browser where
// they use this flow. Every test below logs the just-created signup session
// out first so it exercises the same logged-out state a real locked-out
// user would actually be in, rather than fighting that redirect.
async function logOut(page: import("@playwright/test").Page): Promise<void> {
  await apiFetch(page, "/api/auth/logout", { method: "POST" });
}

test.describe("forgot password — no account enumeration", () => {
  test("requesting a reset for a real, registered email shows the generic success message", async ({ browser }) => {
    // createVerifiedUser (not a raw /signup form fill) — its own synthetic
    // per-call x-forwarded-for header keeps this test's signup off the
    // shared, real 5/hour signup rate limit that every other e2e spec's
    // signups already share one real IP against (see its own comment in
    // helpers/auth.ts). Every other test below does the same, for the
    // same reason.
    const user = await createVerifiedUser(browser, "e2e-forgot-real");
    await logOut(user.page);

    await user.page.goto("/forgot-password");
    await user.page.getByLabel("Email").fill(user.email);
    await user.page.getByRole("button", { name: "Send reset link" }).click();
    // Generous timeout, not the 5s default: this is the one test in the
    // suite where the server actually attempts a real SMTP send (a real
    // registered email — the "never registered" test below short-circuits
    // before ever reaching sendPasswordResetEmail). Confirmed via a direct
    // server-side timing check that a real (mis)configured mailbox's
    // rejected-auth round trip alone can take several seconds — the same
    // "~5-6s observed empirically against smtp-mail.outlook.com" cost
    // already documented in lib/auth/email.ts's own comment. The route
    // catches that failure regardless (see forgot-password/route.ts) and
    // still returns the same generic response either way — this is purely
    // about giving the assertion enough real-world headroom, not a
    // behavior difference to wait out.
    await expect(user.page.getByText("Check your email")).toBeVisible({ timeout: 20_000 });
    await expect(user.page.getByText("If that email has an account, a reset link is on its way.")).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("requesting a reset for an email that was never registered shows the identical message", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(`never-registered-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    await expect(page.getByText("If that email has an account, a reset link is on its way.")).toBeVisible();
  });
});

test.describe("reset password — full flow", () => {
  test("a valid token lets the user set a new password, revokes a separate already-logged-in session, and the new password works", async ({
    browser,
  }) => {
    // userA is "the account owner's laptop, still logged in" (the (auth)
    // layout redirects an authenticated session away from /reset-password
    // — see logOut()'s own comment above — so it can't be the one that
    // submits the reset form). pageB is a fresh, logged-out browser — the
    // realistic place a locked-out user actually clicks a reset link from.
    // This also properly exercises cross-session revocation: userA's
    // session must die because of what happens in pageB, not because this
    // test logged it out itself.
    const userA = await createVerifiedUser(browser, "e2e-reset-full");
    const newPassword = "a-brand-new-password-2";

    // Mints a token directly (no real mailbox in this test environment —
    // same pattern already used for email verification's own e2e
    // coverage), then exercises the real /reset-password page + API route.
    const rawToken = await getRawPasswordResetTokenForEmail(userA.email);
    expect(rawToken).toBeTruthy();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`/reset-password?token=${rawToken}`);
    await pageB.getByLabel("Password", { exact: true }).fill(newPassword);
    await pageB.getByRole("button", { name: "Reset password" }).click();
    await expect(pageB.getByText("Password reset")).toBeVisible();

    // userA's own already-logged-in session must be revoked too — a
    // password reset that leaves a stolen/existing session alive would
    // defeat the point of revoking it. (Session-revocation itself is also
    // covered directly, without a browser, in password-reset.test.ts.)
    await userA.page.goto("/dashboard");
    await expect(userA.page).toHaveURL(/\/login/, { timeout: 5000 });

    // Old password no longer works.
    await userA.page.getByLabel("Email").fill(userA.email);
    await userA.page.getByLabel("Password", { exact: true }).fill(userA.password);
    await userA.page.getByRole("button", { name: "Log in" }).click();
    await expect(userA.page.getByText("Incorrect email or password.")).toBeVisible();

    // New password does.
    await userA.page.getByLabel("Password", { exact: true }).fill(newPassword);
    await userA.page.getByRole("button", { name: "Log in" }).click();
    await expect(userA.page).toHaveURL(/\/dashboard$/, { timeout: 5000 });

    await userA.page.context().close();
    await contextB.close();
    await deleteTestUser(userA.email);
  });

  test("a token can only be used once", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-reset-reuse");
    await logOut(user.page);

    const rawToken = await getRawPasswordResetTokenForEmail(user.email);

    await user.page.goto(`/reset-password?token=${rawToken}`);
    await user.page.getByLabel("Password", { exact: true }).fill("second-password-456");
    await user.page.getByRole("button", { name: "Reset password" }).click();
    await expect(user.page.getByText("Password reset")).toBeVisible();

    // Reusing the exact same link a second time must fail, not silently
    // reset the password again.
    await user.page.goto(`/reset-password?token=${rawToken}`);
    await user.page.getByLabel("Password", { exact: true }).fill("third-password-789");
    await user.page.getByRole("button", { name: "Reset password" }).click();
    await expect(user.page.getByText(/invalid or has already been used/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("an invalid/never-issued token shows a clear error, not a crash", async ({ page }) => {
    await page.goto("/reset-password?token=this-token-was-never-issued");
    await page.getByLabel("Password", { exact: true }).fill("some-password-123");
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText(/invalid or has already been used/i)).toBeVisible();
  });

  test("a reset link with no token at all shows an actionable error", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText("Invalid reset link")).toBeVisible();
    // Rendered as <Button render={<Link .../>} nativeButton={false}> (see
    // component/ui/button.tsx) — Base UI's Button primitive exposes
    // role="button" for a polymorphic render target, not the anchor's own
    // implicit role="link".
    await expect(page.getByRole("button", { name: "Request a new link" })).toBeVisible();
  });

  test("a weak new password is rejected server-side", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-reset-weak");
    await logOut(user.page);

    const rawToken = await getRawPasswordResetTokenForEmail(user.email);
    await user.page.goto(`/reset-password?token=${rawToken}`);
    // minLength=8 is enforced client-side (the same PasswordField
    // component signup uses) — bypass it to confirm the server itself
    // rejects a common/weak password, not just short ones.
    await user.page.getByLabel("Password", { exact: true }).evaluate((el: HTMLInputElement) => {
      el.removeAttribute("minlength");
      el.removeAttribute("required");
    });
    await user.page.getByLabel("Password", { exact: true }).fill("password123");
    await user.page.getByRole("button", { name: "Reset password" }).click();
    await expect(user.page.getByText(/too common|too predictable/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
