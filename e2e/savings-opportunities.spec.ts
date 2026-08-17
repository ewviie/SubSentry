import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 8: new "small subscriptions add up" opportunity type, and the
// evidence-tier-aware prioritization model (getSavingsPriority) — proves
// both render correctly through the real /savings page, not just at the
// unit level.
test.describe("Savings — opportunities and prioritization", () => {
  test("a real 'small subscriptions add up' opportunity renders with an honest, non-savings badge", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-savings-small-subs");

    for (const [name, amount] of [
      ["Dominant Sub", "30.00"],
      ["Juniper", "3.00"],
      ["Kestrel", "3.00"],
      ["Lantern", "3.00"],
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/savings");
    await expect(user.page.getByText(/smaller subscriptions add up to/i)).toBeVisible();
    // Scoped to this specific recommendation card (not the whole page,
    // which legitimately shows dollar figures elsewhere, e.g. potential-
    // savings headline totals) — this card itself never claims a proven
    // "$X/mo" saving, since small_subscriptions is always evidenceTier
    // "review", never "confirmed".
    const card = user.page.locator("div", { hasText: /smaller subscriptions add up to/i }).last();
    await expect(card.getByText(/^\$[\d,.]+\/mo$/)).toHaveCount(0);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // A confirmed duplicate (deterministic evidence) must render ahead of a
  // larger-dollar review-only functional overlap — proves the priority-tier
  // ranking, not a raw-dollar sort, actually reaches the rendered page.
  test("a confirmed duplicate ranks above a larger-dollar functional-overlap review", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-savings-priority-order");

    for (const [name, amount] of [
      ["Netflix", "8.00"],
      ["Netflix Premium", "16.00"], // confirmed duplicate, crosses the $15/mo "high" bar
      ["Adobe Creative Cloud", "50.00"],
      ["Canva Pro", "30.00"], // functional overlap, $80/mo combined but review-only
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/savings");
    const cards = user.page.locator("[class*='shadow-elevation-low']").filter({ hasText: /Netflix|Adobe|Canva/ });
    const firstCardText = await cards.first().innerText();
    // The confirmed duplicate (Netflix Premium) must be the first
    // recommendation card, ahead of the larger-dollar overlap.
    expect(firstCardText).toMatch(/Netflix/);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
