import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Product-value pass, round 2: the dashboard's old single-answer
// "Your biggest opportunity" spotlight (savings-only) was replaced by the
// broader "Needs your attention" panel (attention-panel.tsx), which reads
// real, persisted notifications spanning every detection type, not just
// savings. Same real-world scenarios this file always tested, repointed to
// where that intelligence actually surfaces now.
test.describe("Dashboard — Needs your attention", () => {
  test("a confirmed duplicate surfaces in the attention panel", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-biggest-opp-duplicate");

    for (const [name, amount] of [
      ["Netflix", "8.00"],
      ["Netflix Premium", "20.00"], // confirmed duplicate
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    await expect(panel.getByText(/look like duplicates/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // Honesty check (the whole point of this product-value pass): three
  // unrelated, freshly-added subscriptions with no genuine issue between
  // them must show the real "nothing to flag" empty state, never a
  // manufactured "look at your priciest subscription" nudge with no actual
  // finding behind it — the old BiggestOpportunityCard's fallback behavior,
  // deliberately not carried forward.
  test("shows the honest empty state when nothing has actually been detected", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-biggest-opp-fallback");

    for (const [name, amount] of [
      ["Adobe Creative Cloud", "60.00"],
      ["Spotify", "10.00"],
      ["Dropbox", "10.00"],
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    await expect(panel.getByText(/all caught up/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
