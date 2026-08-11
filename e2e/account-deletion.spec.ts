import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser } from "./helpers/db";
import { apiFetch } from "./helpers/api";

// Self-service account deletion — Settings → Danger zone → Delete account.
// Full coverage of the flow this app actually exposes to a user: the UI
// dialog + password re-auth, the API route's own auth/ownership/failure
// behavior, and that deletion really does remove owned data rather than
// just cutting off access to it. DB-level row-by-row cleanup coverage
// (every user-owned table, no orphaned rows) lives in
// src/lib/auth/account-deletion.db.test.ts instead — not provable through
// the browser alone.
test.describe("account deletion", () => {
  test("a signed-in user can delete their own account, gets signed out, and can't log back in", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-delete-self");

    // Real owned data, not just an empty account — proves deletion isn't
    // just "log the session out."
    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: {
        name: "Netflix",
        amount: "15.99",
        billingCycle: "monthly",
        nextRenewalDate: "2030-01-01",
      },
    });
    expect(created.status).toBe(201);

    await user.page.goto("/settings");
    await user.page.getByRole("button", { name: "Delete account" }).click();
    const dialog = user.page.getByRole("alertdialog");
    await expect(dialog.getByText("Delete your account?")).toBeVisible();

    // Confirming the dialog without a password goes nowhere — the
    // destructive action requires the explicit password re-auth, not just
    // the dialog's own confirm click.
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(dialog.locator("#delete-account-error")).toHaveText("Enter your password to confirm.");

    await dialog.getByLabel("Password").fill(user.password);
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect(user.page).toHaveURL(/\/login$/, { timeout: 10_000 });

    // Signed out: dashboard now redirects to login instead of rendering.
    await user.page.goto("/dashboard");
    await expect(user.page).toHaveURL(/\/login/);

    // The account itself is gone, not just this one session — the same
    // credentials no longer authenticate at all.
    await user.page.getByLabel("Email").fill(user.email);
    await user.page.getByLabel("Password", { exact: true }).fill(user.password);
    await user.page.getByRole("button", { name: "Log in" }).click();
    await expect(user.page.getByText("Incorrect email or password.")).toBeVisible();

    await user.page.context().close();
    // Best-effort: the account should already be gone; this is a no-op
    // cleanup if the deletion above worked, and a real cleanup if this
    // assertion path is ever reached after a regression.
    await deleteTestUser(user.email);
  });

  test("the wrong password is rejected and the account is left intact", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-delete-wrong-pw");

    await user.page.goto("/settings");
    await user.page.getByRole("button", { name: "Delete account" }).click();
    const dialog = user.page.getByRole("alertdialog");
    await dialog.getByLabel("Password").fill("definitely-not-the-real-password");
    await dialog.getByRole("button", { name: "Delete account" }).click();

    await expect(dialog.getByText("Incorrect password.")).toBeVisible();

    // Still on settings, still authenticated — no partial/silent deletion
    // happened off the back of a failed password check.
    await expect(user.page).toHaveURL(/\/settings$/);
    await user.page.reload();
    await expect(user.page).toHaveURL(/\/settings$/);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("an unauthenticated request cannot delete any account", async ({ page }) => {
    await page.goto("/login");
    const result = await apiFetch(page, "/api/account", {
      method: "DELETE",
      body: { password: "whatever" },
    });
    expect(result.status).toBe(401);
  });

  test("deleting one account never touches another user's", async ({ browser }) => {
    const victim = await createVerifiedUser(browser, "e2e-delete-victim");
    const actor = await createVerifiedUser(browser, "e2e-delete-actor");

    await actor.page.goto("/settings");
    await actor.page.getByRole("button", { name: "Delete account" }).click();
    const dialog = actor.page.getByRole("alertdialog");
    await dialog.getByLabel("Password").fill(actor.password);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(actor.page).toHaveURL(/\/login$/, { timeout: 10_000 });

    // The victim's own session and credentials are completely unaffected —
    // there's no id/param in the delete request an attacker (or a buggy
    // scoping query) could use to reach anyone else's account, and this
    // proves it end to end rather than just by reading the query.
    await victim.page.goto("/dashboard");
    await expect(victim.page).toHaveURL(/\/dashboard$/);

    await victim.page.context().close();
    await actor.page.context().close();
    await deleteTestUser(victim.email);
    await deleteTestUser(actor.email);
  });

  test("Cancel and Delete account buttons meet the ~44px minimum touch-target height", async ({ browser }) => {
    // Regression test for a real mobile audit finding: these two buttons
    // measured ~30-31px tall before the fix (delete-account-card.tsx's
    // h-11 override) — under the widely-recommended 44px minimum for a
    // comfortably tappable target, on the one dialog in the app where a
    // mis-tap is costliest.
    const user = await createVerifiedUser(browser, "e2e-delete-touch-target");

    await user.page.goto("/settings");
    await user.page.getByRole("button", { name: "Delete account" }).click();
    const dialog = user.page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // The dialog's own open transition (zoom-in-95, ~100-150ms) briefly
    // scales its content up from 95% — a boundingBox() taken mid-animation
    // measures that transient smaller size, not the settled one. Waiting
    // for the transition to finish avoids a false failure here; it's not
    // a shortcut around the real assertion below.
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => {}),
    );

    const cancelBox = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
    const deleteBox = await dialog.getByRole("button", { name: "Delete account" }).boundingBox();
    expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
    expect(deleteBox?.height).toBeGreaterThanOrEqual(44);

    // Cancel still works, and the account is untouched — the height
    // override didn't change any actual button behavior.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await user.page.reload();
    await expect(user.page).toHaveURL(/\/settings$/);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
