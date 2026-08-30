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
// dashboard, not just the unit-level engine output.
//
// Phase 7.2 update: 3 renewals landing the same week used to be sufficient
// on its own to trip health.renewal_clustering's warning branch. That rule
// no longer exists — clustering by count alone is neutral, zero-impact
// context now (health.renewal_risk; see that rule's own comment on why
// "several renewals land the same week" isn't automatically unhealthy).
// Only a genuine cash-flow spike — the amount due well above typical
// monthly spend — still warrants a warning, so this fixture now clusters a
// large yearly charge alongside the normal monthly baseline instead of 3
// equally-cheap renewals, to keep proving Quick wins renders a real warning
// end-to-end.
test.describe("dashboard — Quick wins", () => {
  test("a real renewal-spike finding renders with a working Review link", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-quick-wins");

    // health.renewal_risk's spike check looks at what's actually due within
    // the next 30 days of *today* (not just clustered relative to each
    // other) — unlike the old clustering-only rule, these need to be real
    // near-term dates, not an arbitrary future placeholder.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

    const clusteredIds: string[] = [];
    for (const [name, date, amount, billingCycle] of [
      ["Netflix", day(2), "9.99", "monthly"],
      ["Spotify", day(3), "9.99", "monthly"],
      ["Big Annual Plan", day(4), "300.00", "yearly"],
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle, nextRenewalDate: date },
      });
      expect(created.status).toBe(201);
      clusteredIds.push((created.body as { subscription: { id: string } }).subscription.id);
    }

    await user.page.goto("/dashboard");
    await expect(user.page.getByText("Quick wins")).toBeVisible();
    // The same finding text renders twice on this dashboard — once as
    // QuickWinsCard's own title (<p class="font-medium">) and once as a
    // warnings list's description elsewhere — so this scopes to the first
    // match (QuickWinsCard's, first in DOM order) rather than hitting a
    // Playwright strict-mode multiple-match error.
    await expect(user.page.locator("p", { hasText: "More than usual is due in the next 30 days" }).first()).toBeVisible();

    // Rendered as a Button (role=button), same polymorphic render-prop
    // pattern documented in renewal-reminders.spec.ts — not a link role.
    // exact: true guards against Savings opportunities' own "Review {name}"
    // buttons (e.g. "Review Netflix") also matching a substring search for
    // "Review". It doesn't guard against the Premium Optimization
    // recommendations / Risk alerts cards' own bare "Review" buttons
    // though (insight-panels.tsx) — this fixture's two $9.99/mo
    // subscriptions are enough on their own to also trip the annual-plan-
    // savings rule, and every authenticated user sees Premium cards during
    // the beta (BETA_ALL_ACCESS), so a page-wide search can legitimately
    // match more than one "Review" button. Scoped to the Quick wins card
    // itself, the one this test is actually about.
    const quickWinsCard = user.page.locator('[data-slot="card"]', { has: user.page.getByText("Quick wins") });
    const reviewButton = quickWinsCard.getByRole("button", { name: "Review", exact: true });
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
