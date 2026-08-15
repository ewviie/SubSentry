import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 6 fix: every "review this subscription" path in the app (Savings,
// Quick wins, the renewal-reminder email) used to land on the detail page
// with nothing beyond an edit form and a delete button — no way to actually
// act on "you should cancel this." See edit-subscription-form.tsx's own
// comment on why this is a real (honest, non-fabricated) search link and
// not a claimed direct cancellation URL.
test.describe("subscription detail — cancellation guidance", () => {
  test("an active subscription offers a real search link to cancel it, naming the actual service", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-cancel-guidance-active");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-15" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    await user.page.goto(`/subscriptions/${id}`);
    await expect(user.page.getByText("Canceling Netflix?")).toBeVisible();

    // Rendered as a Button (role=button) wrapping an <a> under the hood —
    // same polymorphic-render pattern the "Go to Settings" control in
    // renewal-reminders.spec.ts already documents, not a plain link role.
    const link = user.page.getByRole("button", { name: /Search how to cancel Netflix/ });
    await expect(link).toBeVisible();
    // Opens in a new tab, never navigates the app away from itself.
    await expect(link).toHaveAttribute("target", "_blank");
    // A real, working search query naming the actual subscription — never
    // a fabricated claim of a specific vendor cancellation page.
    const href = await link.getAttribute("href");
    expect(href).toContain("google.com/search");
    // URLSearchParams encodes spaces as "+" (query-string convention), not
    // "%20" — decodeURIComponent alone doesn't turn "+" back into a space.
    expect(decodeURIComponent((href ?? "").replace(/\+/g, " "))).toContain("cancel Netflix subscription");

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("a subscription already marked canceled doesn't repeat the guidance", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-cancel-guidance-canceled");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Hulu", amount: "7.99", billingCycle: "monthly", nextRenewalDate: "2099-01-15" },
    });
    const id = (created.body as { subscription: { id: string } }).subscription.id;
    const patched = await apiFetch(user.page, `/api/subscriptions/${id}`, {
      method: "PATCH",
      body: { status: "canceled" },
    });
    expect(patched.status).toBe(200);

    await user.page.goto(`/subscriptions/${id}`);
    await expect(user.page.getByText("Canceling Hulu?")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
