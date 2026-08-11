import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser } from "./helpers/db";
import { apiFetch } from "./helpers/api";

// Regression coverage for a real mobile-audit finding: /dashboard and
// /settings both had ~150-270px of horizontal overflow at every common
// mobile width. Root cause: the "Welcome, {name}" / account-name header on
// each page falls back to the account's email when no display name is
// set, and — inside a flex row with no min-w-0 on the text column — an
// email (one long unbreakable token, no spaces) forced the row wider than
// the viewport instead of wrapping. Fixed with min-w-0 on the flex item +
// break-words on the heading itself; asserted here against a real account
// whose name is unset (the exact condition that reproduced it), not a
// short/synthetic one that would pass by accident.
const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
];

for (const vp of VIEWPORTS) {
  test.describe(`mobile viewport ${vp.name}`, () => {
    // No test.use({ viewport }) here — both tests below create their own
    // browser context via createVerifiedUser (needed for signup/session
    // isolation), which bypasses the fixture-provided default context
    // test.use() configures. viewport is passed explicitly into
    // createVerifiedUser instead, which is what actually lands the page at
    // vp.width/vp.height.
    test(`/dashboard and /settings have no horizontal overflow at ${vp.name}`, async ({ browser }) => {
      const user = await createVerifiedUser(browser, `e2e-mobile-${vp.name.replace("x", "-")}`, {
        viewport: { width: vp.width, height: vp.height },
      });

      await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2030-01-01" },
      });

      for (const path of ["/dashboard", "/settings"]) {
        await user.page.goto(path);
        const { innerWidth, scrollWidth } = await user.page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(innerWidth, "viewport must actually be the requested mobile size").toBe(vp.width);
        expect(scrollWidth, `${path} must not scroll horizontally at ${vp.name}`).toBeLessThanOrEqual(innerWidth);
      }

      await user.page.context().close();
      await deleteTestUser(user.email);
    });

    test(`account-deletion dialog fits the viewport and buttons stay tappable at ${vp.name}`, async ({ browser }) => {
      const user = await createVerifiedUser(browser, `e2e-mobile-del-${vp.name.replace("x", "-")}`, {
        viewport: { width: vp.width, height: vp.height },
      });

      await user.page.goto("/settings");
      await user.page.getByRole("button", { name: "Delete account" }).click();
      const dialog = user.page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      // See account-deletion.spec.ts's identical wait for why this is
      // needed before measuring: the dialog's own open transition
      // (zoom-in-95) briefly scales its content up from 95%, and a
      // boundingBox() taken mid-animation measures that transient size.
      await dialog.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => {}),
      );

      const dialogBox = await dialog.boundingBox();
      const vpSize = user.page.viewportSize();
      expect(dialogBox, "dialog must be measurable").not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(vpSize!.width + 1);

      const cancelBox = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
      const deleteBox = await dialog.getByRole("button", { name: "Delete account" }).boundingBox();
      expect(cancelBox?.height).toBeGreaterThanOrEqual(44);
      expect(deleteBox?.height).toBeGreaterThanOrEqual(44);

      await user.page.context().close();
      await deleteTestUser(user.email);
    });
  });
}
