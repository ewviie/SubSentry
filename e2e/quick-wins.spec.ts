import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 6 fix: the dashboard's "Quick wins" card could never render for any
// user, under any data — its source array was always empty (see engine.ts's
// own comment on the fix). This proves the fix end-to-end through the real
// dashboard, not just the unit-level engine output: 3 subscriptions renewing
// within the same 7-day window trip health.renewal_clustering's warning
// branch, which should now surface as an actionable Quick win with a link to
// one of the actual subscriptions.
test.describe("dashboard — Quick wins", () => {
  test("a real renewal-clustering finding renders with a working Review link", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-quick-wins");

    const clusteredIds: string[] = [];
    for (const [name, date] of [
      ["Netflix", "2099-03-01"],
      ["Spotify", "2099-03-02"],
      ["Hulu", "2099-03-03"],
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount: "9.99", billingCycle: "monthly", nextRenewalDate: date },
      });
      expect(created.status).toBe(201);
      clusteredIds.push((created.body as { subscription: { id: string } }).subscription.id);
    }

    await user.page.goto("/dashboard");
    await expect(user.page.getByText("Quick wins")).toBeVisible();
    // The same finding text is also the health-score breakdown's label
    // (ScoreBreakdownCard renders it in a <span>) — scope to the <p> tag
    // QuickWinsCard actually uses so this doesn't hit a strict-mode
    // multiple-match error against that unrelated card.
    await expect(user.page.locator("p", { hasText: "3 renewals land the same week" })).toBeVisible();

    // Rendered as a Button (role=button), same polymorphic render-prop
    // pattern documented in renewal-reminders.spec.ts — not a link role.
    // exact: true matters here too — Savings opportunities' own "Review
    // {name}" buttons (e.g. "Review Netflix") would otherwise also match a
    // substring search for "Review", and this dashboard state (3
    // subscriptions in the same default "other" category) triggers that
    // card too.
    const reviewButton = user.page.getByRole("button", { name: "Review", exact: true });
    await expect(reviewButton).toBeVisible();
    await reviewButton.click();
    // Not just "any subscription page" — the finding names a specific
    // 3-subscription cluster (see engine.ts's QuickWinsCard/health.ts
    // comment: the Review target is win.subscriptionIds[0], the first of
    // that cluster), so the click must land on one of those three, not an
    // unrelated subscription.
    await expect(user.page).toHaveURL(/\/subscriptions\/([0-9a-f-]+)$/);
    const landedId = new URL(user.page.url()).pathname.split("/").pop();
    expect(clusteredIds).toContain(landedId);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
