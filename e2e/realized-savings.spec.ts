import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 7 addition: the "what have you actually saved" half of the savings
// story (savings.ts's computeRealizedSavings) - distinct from the
// pre-existing "potential savings" section, both in data source (canceled
// subscriptions' own stored amount, not a detected opportunity) and in
// wording (never "confirmed" - that word already means something different
// elsewhere on this page/dashboard).
test.describe("Savings — money saved so far", () => {
  test("does not appear with no canceled subscriptions", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-none");

    await user.page.goto("/savings");
    await expect(user.page.getByText("Money saved so far")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("shows a real total from canceled subscriptions, and updates the delete-dialog copy for them", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-some");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Hulu", amount: "7.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    const canceled = await apiFetch(user.page, `/api/subscriptions/${id}`, {
      method: "PATCH",
      body: { status: "canceled" },
    });
    expect(canceled.status).toBe(200);

    await user.page.goto("/savings");
    await expect(user.page.getByText("Money saved so far")).toBeVisible();
    await expect(user.page.getByText("$7.99/mo")).toBeVisible();
    await expect(user.page.getByText(/From 1 subscription you've canceled here/)).toBeVisible();

    // The delete dialog for this already-canceled subscription must
    // acknowledge the effect on this exact total — a live query, not a
    // ledger, so deleting it changes the number above.
    await user.page.goto(`/subscriptions/${id}`);
    await user.page.getByRole("button", { name: "Delete subscription" }).click();
    await expect(user.page.getByText(/Money saved so far/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // Regression: currency is unvalidated free text on this schema; summing
  // raw cents across two canceled subscriptions in different currencies
  // would produce a number wearing a real one's formatting. Caught by
  // CodeRabbit against computeRealizedSavings' first version, fixed to
  // return null totals (an honest gap) rather than a fabricated sum.
  test("shows an honest gap, not a fabricated total, when canceled subscriptions span more than one currency", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-mixed-currency");

    const usd = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Hulu", amount: "7.99", currency: "usd", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    const eur = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Spotify", amount: "9.99", currency: "eur", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(usd.status).toBe(201);
    expect(eur.status).toBe(201);
    const usdId = (usd.body as { subscription: { id: string } }).subscription.id;
    const eurId = (eur.body as { subscription: { id: string } }).subscription.id;

    for (const id of [usdId, eurId]) {
      const patched = await apiFetch(user.page, `/api/subscriptions/${id}`, { method: "PATCH", body: { status: "canceled" } });
      expect(patched.status).toBe(200);
    }

    await user.page.goto("/savings");
    await expect(user.page.getByText("Money saved so far")).toBeVisible();
    await expect(user.page.getByText(/2 subscriptions canceled here/)).toBeVisible();
    await expect(user.page.getByText(/can't be honestly added into one total/)).toBeVisible();
    // Never a fabricated combined figure.
    await expect(user.page.getByText(/\/mo$/)).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("an active subscription's delete dialog does not mention the savings total", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-active-delete");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Spotify", amount: "9.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    await user.page.goto(`/subscriptions/${id}`);
    await user.page.getByRole("button", { name: "Delete subscription" }).click();
    await expect(user.page.getByText("This removes it and its history permanently. This can't be undone.")).toBeVisible();
    await expect(user.page.getByText(/Money saved so far/)).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
