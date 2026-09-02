import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 8 Intelligence, opportunity #2: the "what have you actually saved"
// half of the savings story (savings.ts's computeRealizedSavings) - distinct
// from the pre-existing "potential savings" section, both in data source (a
// persisted realizedSavings ledger row written at the moment of a genuine
// active->canceled transition — schema.ts, queries.ts's updateSubscription —
// never a detected opportunity or a live re-scan of the subscription's own
// current row) and in wording (never "confirmed" - that word already means
// something different elsewhere on this page/dashboard).
test.describe("Savings — money saved so far", () => {
  test("does not appear with no canceled subscriptions", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-none");

    await user.page.goto("/savings");
    await expect(user.page.getByText("Money saved so far")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("shows a real total from a genuine cancellation, annualized as the headline figure", async ({ browser }) => {
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
    // $7.99/mo annualizes to $95.88/yr — the headline figure now, with the
    // monthly figure as supporting context (savings/page.tsx).
    await expect(user.page.getByText("$95.88/yr")).toBeVisible();
    await expect(user.page.getByText(/From 1 subscription you've canceled here/)).toBeVisible();
    await expect(user.page.getByText(/\$7\.99\/mo/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // The core promise of the persisted ledger (schema.ts's realizedSavings):
  // deleting the now-canceled subscription must NOT erase or shrink this
  // total, unlike the old live-derived version of this number. The delete
  // dialog no longer claims otherwise either.
  test("deleting a canceled subscription does not change the realized-savings total", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-delete-survives");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Hulu", amount: "7.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    const id = (created.body as { subscription: { id: string } }).subscription.id;
    const canceled = await apiFetch(user.page, `/api/subscriptions/${id}`, { method: "PATCH", body: { status: "canceled" } });
    expect(canceled.status).toBe(200);

    await user.page.goto(`/subscriptions/${id}`);
    await user.page.getByRole("button", { name: "Delete subscription" }).click();
    // No longer mentions the realized-savings total — deleting the row
    // can't change a fact that's already been permanently recorded.
    await expect(user.page.getByText(/Money saved so far/)).not.toBeVisible();
    await user.page.getByRole("button", { name: "Delete" }).click();
    await expect(user.page).toHaveURL("/dashboard");

    await user.page.goto("/savings");
    await expect(user.page.getByText("Money saved so far")).toBeVisible();
    await expect(user.page.getByText("$95.88/yr")).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // Regression: currency is unvalidated free text on this schema; summing
  // raw cents across two canceled subscriptions in different currencies
  // would produce a number wearing a real one's formatting. Caught by
  // CodeRabbit against computeRealizedSavings' first (live-derived) version,
  // fixed to return null totals (an honest gap) rather than a fabricated
  // sum — the same rule the persisted-ledger version still enforces.
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
    await expect(user.page.getByText(/\/yr$/)).not.toBeVisible();

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

  // The cancellation confirmation itself now communicates the annualized
  // recorded saving, matching what /savings' own headline figure will show.
  test("the quick-cancel confirmation states the annualized saving", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-realized-savings-toast");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-15" },
    });
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    await user.page.goto(`/subscriptions/${id}`);
    await user.page.getByRole("button", { name: "Mark as canceled" }).click();
    // $15.99/mo annualizes to $191.88/yr.
    await expect(user.page.getByText(/You'll save about \$191\.88\/year/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
