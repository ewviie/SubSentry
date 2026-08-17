import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 9: "Your biggest opportunity" — a single, committed spotlight
// pick, distinct from the ranked Savings opportunities/Quick wins lists
// further down the same page. Proves the real ranking (confirmed saving >
// renewal-risk spike > review saving > highest-cost fallback — see
// computeBiggestOpportunity's own header comment) actually reaches the
// rendered dashboard, not just the unit-level fixtures in
// biggest-opportunity.test.ts.
test.describe("Dashboard — Your biggest opportunity", () => {
  test("a confirmed duplicate above the high-impact threshold wins the spotlight", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-biggest-opp-duplicate");

    for (const [name, amount] of [
      ["Netflix", "8.00"],
      ["Netflix Premium", "20.00"], // confirmed duplicate, crosses the $15/mo "high" bar
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/dashboard");
    const spotlight = user.page.locator("text=Your biggest opportunity").locator("..").locator("..");
    await expect(spotlight.getByText(/look like duplicates/i)).toBeVisible();
    await expect(spotlight.getByText(/confirmed duplicate is the most certain saving/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("falls back to the highest-cost subscription and its share of spend when nothing else qualifies", async ({
    browser,
  }) => {
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
    const spotlight = user.page.locator("text=Your biggest opportunity").locator("..").locator("..");
    await expect(spotlight.getByText("Adobe Creative Cloud")).toBeVisible();
    await expect(spotlight.getByText(/largest recurring expense/i)).toBeVisible();
    // 60 / (60+10+10) = 75%
    await expect(spotlight.getByText(/75%/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
