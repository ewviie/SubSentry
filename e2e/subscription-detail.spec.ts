import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 9: subscription detail page enrichment (price history, share of
// spend, related subscriptions) — proves the real write/read path (create
// -> price_history "initial" row -> edit -> "user_edit" row ->
// computeLatestPriceChange) reaches the rendered page, and that the
// functional-overlap grouping already used by Savings opportunities shows
// up as "Related subscriptions" here too.
test.describe("Subscription detail page", () => {
  test("a subscription with no price change shows the honest 'started tracking' note, not a fabricated one", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-detail-no-change");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Steady Sub", amount: "9.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    await user.page.goto(`/subscriptions/${id}`);
    await expect(user.page.getByText(/We started tracking this subscription's price on/i)).toBeVisible();
    await expect(user.page.getByText(/Price increased|Price decreased/i)).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("editing the amount records a real price change, shown with the correct percent and yearly delta", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-detail-price-change");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Rising Sub", amount: "10.00", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    const patched = await apiFetch(user.page, `/api/subscriptions/${id}`, {
      method: "PATCH",
      body: { amount: "12.00" },
    });
    expect(patched.status).toBe(200);

    await user.page.goto(`/subscriptions/${id}`);
    await expect(user.page.getByText(/Price increased 20%/i)).toBeVisible();
    // (12.00 - 10.00) * 12 = $24.00/year
    await expect(user.page.getByText(/additional \$24\.00\/year/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("shows share of total spend and links to the other member of a functional-overlap group", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-detail-related");

    const adobe = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Adobe Creative Cloud", amount: "60.00", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(adobe.status).toBe(201);
    const adobeId = (adobe.body as { subscription: { id: string } }).subscription.id;

    const canva = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Canva Pro", amount: "20.00", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(canva.status).toBe(201);

    await user.page.goto(`/subscriptions/${adobeId}`);
    // 60 / (60 + 20) = 75%
    await expect(user.page.getByText("75%")).toBeVisible();
    await expect(user.page.getByText("Related subscriptions")).toBeVisible();
    await expect(user.page.getByRole("link", { name: "Canva Pro" })).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
