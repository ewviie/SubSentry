import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Regression coverage for the Product Polish pass's #4 fix: the
// subscriptions list already badges "Possible duplicate" on a matching
// pair, but clicking into either one's detail page used to show no trace
// of it — no mention of the other subscription, no way to compare them.
test.describe("subscription detail — duplicate context", () => {
  test("shows the matching subscription and links to it, for a real flagged pair", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-dup-detail");

    const first = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-15" },
    });
    const second = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-02-20" },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = (first.body as { subscription: { id: string } }).subscription.id;
    const secondId = (second.body as { subscription: { id: string } }).subscription.id;

    await user.page.goto(`/subscriptions/${firstId}`);
    await expect(user.page.getByText("Possible duplicate")).toBeVisible();
    // The matching subscription's own renewal date, not a guessed one —
    // confirms this is real data, not invented copy.
    await expect(user.page.getByText("2099-02-20")).toBeVisible();

    // The only "Netflix" *link* on this page (the CardTitle above it is a
    // heading, not a link) is the duplicate notice's link to the match.
    await user.page.getByRole("link", { name: "Netflix" }).click();
    await expect(user.page).toHaveURL(new RegExp(`/subscriptions/${secondId}$`));
    // Reciprocal: the second one's detail page points back at the first.
    await expect(user.page.getByText("2099-01-15")).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("shows no duplicate notice for a subscription with no match", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-dup-detail-none");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Adobe Creative Cloud", amount: "54.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    await user.page.goto(`/subscriptions/${id}`);
    await expect(user.page.getByText("Possible duplicate")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
