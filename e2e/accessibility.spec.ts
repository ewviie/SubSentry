import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Regression coverage for a real a11y bug found during the frontend design
// review: every CardTitle across the app rendered a <div>, not a heading
// element — visually styled like a heading but completely invisible to a
// screen reader's heading-navigation list. Fixed by giving CardTitle an
// `as` prop (default "h3", explicit "h1" where a card title is a page's
// only heading). These tests assert the actual accessibility tree, not
// just that the fix compiles.
test.describe("heading semantics", () => {
  test("login page's card title is a real h1, not a div", async ({ page }) => {
    await page.goto("/login");
    const heading = page.getByRole("heading", { level: 1, name: "Welcome back" });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveJSProperty("tagName", "H1");
  });

  test("signup page's card title is a real h1, not a div", async ({ page }) => {
    await page.goto("/signup");
    const heading = page.getByRole("heading", { level: 1, name: "Create your account" });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveJSProperty("tagName", "H1");
  });

  test("settings page has one h1 (page title) and real headings for each card section, correctly nested under it", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-a11y-settings");
    await user.page.goto("/settings");

    // Exactly one h1 — the user's own name/email, not a second competing
    // page title hiding in a card.
    await expect(user.page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // Each settings card's title is a real heading (h3, per CardTitle's
    // default), not a div — findable by role, not just by text content.
    await expect(user.page.getByRole("heading", { level: 3, name: "Account" })).toBeVisible();
    await expect(user.page.getByRole("heading", { level: 3, name: /Plan/ })).toBeVisible();
    await expect(user.page.getByRole("heading", { level: 3, name: "AI" })).toBeVisible();

    await deleteTestUser(user.email);
  });
});
