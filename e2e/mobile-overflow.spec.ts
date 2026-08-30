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
    // /subscriptions/import and /subscriptions/new added alongside the
    // original /dashboard and /settings coverage — both are on the
    // first-time activation path (Phase 3's explicit mobile-first
    // requirement) and neither had any mobile-overflow regression coverage
    // before, unlike the two pages this test already protected.
    //
    // /subscriptions/[id] added in Phase 6 — the detail page gained new
    // content (the cancellation-guidance box and its button, only shown for
    // an active subscription) that had no mobile coverage of its own before.
    //
    // /savings added in Phase 7 alongside the rest of this list — baseline
    // coverage without any realized-savings history; the dedicated
    // long-sentence case (a canceled subscription's "Money saved so far"
    // block) gets its own test below, same split as the long-name case.
    //
    // /subscriptions (the list/explorer page, distinct from
    // /subscriptions/[id] below) added for the Free-tier CSV-export icon
    // button — a real new element in that page's own top action row, not
    // previously covered by anything in this file.
    test(`/dashboard, /settings, /subscriptions, /subscriptions/import, /subscriptions/new, /subscriptions/[id], and /savings have no horizontal overflow at ${vp.name}`, async ({ browser }) => {
      const user = await createVerifiedUser(browser, `e2e-mobile-${vp.name.replace("x", "-")}`, {
        viewport: { width: vp.width, height: vp.height },
      });

      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2030-01-01" },
      });
      const subscriptionId = (created.body as { subscription: { id: string } }).subscription.id;

      for (const path of [
        "/dashboard",
        "/settings",
        "/subscriptions",
        "/subscriptions/import",
        "/subscriptions/new",
        `/subscriptions/${subscriptionId}`,
        "/savings",
      ]) {
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

    // The subscription-detail overflow check above uses a short name
    // ("Netflix") — real risk for the Phase 6 cancellation-guidance box is
    // a long, unbroken subscription name (it appears 3 times in that box:
    // the heading, the body text, and the button label), the same overflow
    // shape as this file's own "Welcome, {email}" regression at the top —
    // a long single token with no natural break point. Tested at the
    // tightest viewport only; if it fits at 320px it fits at the wider ones
    // covered by the loop above.
    if (vp.width === 320) {
      test(`subscription detail — a long subscription name doesn't overflow the cancellation-guidance box at ${vp.name}`, async ({ browser }) => {
        const user = await createVerifiedUser(browser, `e2e-mobile-cancel-${vp.name.replace("x", "-")}`, {
          viewport: { width: vp.width, height: vp.height },
        });

        const longName = "SuperLongStreamingServiceNameWithoutAnySpacesAtAllForTestingPurposesOverflow";
        const created = await apiFetch(user.page, "/api/subscriptions", {
          method: "POST",
          body: { name: longName, amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2030-01-01" },
        });
        const subscriptionId = (created.body as { subscription: { id: string } }).subscription.id;

        await user.page.goto(`/subscriptions/${subscriptionId}`);
        await expect(user.page.getByText(`Canceling ${longName}?`)).toBeVisible();
        const { innerWidth, scrollWidth } = await user.page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(scrollWidth, `subscription detail must not scroll horizontally at ${vp.name} with a long name`).toBeLessThanOrEqual(innerWidth);

        await user.page.context().close();
        await deleteTestUser(user.email);
      });

      // Phase 7's "Money saved so far" block (savings/page.tsx) has the
      // same long-unbroken-name overflow shape as the cancellation-guidance
      // box above, plus a longer wrapping sentence than most of this page's
      // other content — a real, distinct overflow risk from the plain
      // baseline /savings check in the main loop above, which never has any
      // canceled subscriptions to render this block at all.
      test(`Savings — a long subscription name doesn't overflow the "Money saved so far" block at ${vp.name}`, async ({ browser }) => {
        const user = await createVerifiedUser(browser, `e2e-mobile-realized-${vp.name.replace("x", "-")}`, {
          viewport: { width: vp.width, height: vp.height },
        });

        const longName = "SuperLongStreamingServiceNameWithoutAnySpacesAtAllForTestingPurposesOverflow";
        const created = await apiFetch(user.page, "/api/subscriptions", {
          method: "POST",
          body: { name: longName, amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2030-01-01" },
        });
        const subscriptionId = (created.body as { subscription: { id: string } }).subscription.id;
        await apiFetch(user.page, `/api/subscriptions/${subscriptionId}`, { method: "PATCH", body: { status: "canceled" } });

        await user.page.goto("/savings");
        await expect(user.page.getByText("Money saved so far")).toBeVisible();
        const { innerWidth, scrollWidth } = await user.page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(scrollWidth, `/savings must not scroll horizontally at ${vp.name} with realized savings`).toBeLessThanOrEqual(innerWidth);

        await user.page.context().close();
        await deleteTestUser(user.email);
      });
    }

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
