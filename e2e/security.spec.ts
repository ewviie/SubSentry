import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

test.describe("IDOR — cross-user resource access", () => {
  test("user B cannot read user A's subscription by guessing/reusing its id", async ({ browser }) => {
    const userA = await createVerifiedUser(browser, "e2e-idor-a");
    const userB = await createVerifiedUser(browser, "e2e-idor-b");

    // Create a real subscription as user A through the actual UI, not a
    // direct DB insert — this exercises the same API path a real attacker
    // would be probing.
    await userA.page.goto("/subscriptions/new");
    await userA.page.getByLabel("Name").fill("User A Private Netflix");
    await userA.page.getByLabel(/amount/i).fill("15.99");
    await userA.page.getByRole("button", { name: /add subscription/i }).click();
    await userA.page.waitForURL(/\/dashboard$/);

    const list = await apiFetch(userA.page, "/api/subscriptions");
    const created = (list.body as { subscriptions: { id: string; name: string }[] }).subscriptions.find(
      (s) => s.name === "User A Private Netflix",
    );
    expect(created).toBeTruthy();

    // User B's own authenticated session, hitting user A's real id directly.
    const crossUserGet = await apiFetch(userB.page, `/api/subscriptions/${created!.id}`);
    expect(crossUserGet.status).toBe(404);

    const crossUserPatch = await apiFetch(userB.page, `/api/subscriptions/${created!.id}`, {
      method: "PATCH",
      body: { name: "Hijacked" },
    });
    expect(crossUserPatch.status).toBe(404);

    const crossUserDelete = await apiFetch(userB.page, `/api/subscriptions/${created!.id}`, { method: "DELETE" });
    expect(crossUserDelete.status).toBe(404);

    // Confirm it's genuinely untouched, not just hidden from B's view.
    const stillIntact = await apiFetch(userA.page, `/api/subscriptions/${created!.id}`);
    expect((stillIntact.body as { subscription: { name: string } }).subscription.name).toBe(
      "User A Private Netflix",
    );

    await userA.page.context().close();
    await userB.page.context().close();
    await deleteTestUser(userA.email);
    await deleteTestUser(userB.email);
  });

  test("navigating directly to another user's subscription detail page renders not-found, not their data", async ({
    browser,
  }) => {
    const userA = await createVerifiedUser(browser, "e2e-idor-nav-a");
    const userB = await createVerifiedUser(browser, "e2e-idor-nav-b");

    await userA.page.goto("/subscriptions/new");
    await userA.page.getByLabel("Name").fill("A Secret Subscription Name");
    await userA.page.getByLabel(/amount/i).fill("9.99");
    await userA.page.getByRole("button", { name: /add subscription/i }).click();
    await userA.page.waitForURL(/\/dashboard$/);

    const list = await apiFetch(userA.page, "/api/subscriptions");
    const created = (list.body as { subscriptions: { id: string; name: string }[] }).subscriptions.find(
      (s) => s.name === "A Secret Subscription Name",
    );
    expect(created).toBeTruthy();

    await userB.page.goto(`/subscriptions/${created!.id}`);
    await expect(userB.page.getByText("A Secret Subscription Name")).not.toBeVisible();

    await userA.page.context().close();
    await userB.page.context().close();
    await deleteTestUser(userA.email);
    await deleteTestUser(userB.email);
  });
});

test.describe("malicious input handling", () => {
  test("an XSS-shaped subscription name is rendered as inert text, not executed", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-xss");
    const payload = '<img src=x onerror="window.__xss_fired=true">';

    let alertFired = false;
    user.page.on("dialog", async (dialog) => {
      alertFired = true;
      await dialog.dismiss();
    });

    await user.page.goto("/subscriptions/new");
    await user.page.getByLabel("Name").fill(payload);
    await user.page.getByLabel(/amount/i).fill("5.00");
    await user.page.getByRole("button", { name: /add subscription/i }).click();
    await user.page.waitForURL(/\/dashboard$/);

    const xssFlagFired = await user.page.evaluate(() => (window as unknown as { __xss_fired?: boolean }).__xss_fired);
    expect(xssFlagFired).toBeUndefined();
    expect(alertFired).toBe(false);
    // The literal, unescaped string should still be visible as plain text
    // somewhere on the page (React's default text-interpolation escaping,
    // not a WAF stripping the input) — confirms it was stored and
    // rendered, just never parsed as markup. It legitimately appears in
    // more than one place (the subscriptions list, insights, quick-add
    // history), so this only asserts "at least one," not "exactly one."
    await expect(user.page.getByText(payload, { exact: false }).first()).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("an oversized subscription name is rejected server-side, not just visually truncated", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-oversized");
    const response = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: {
        name: "a".repeat(121),
        amount: "9.99",
        billingCycle: "monthly",
        nextRenewalDate: "2099-01-01",
      },
    });
    expect(response.status).toBe(400);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
