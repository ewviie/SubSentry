import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Same negative-amount reasoning as import-duplicate-review.spec.ts's own
// comment: a bank CSV's debit needs a leading "-" to survive csv-parser.ts's
// default-credit filtering.
function csvFor(amount: string): string {
  return [
    "Date,Description,Amount",
    `2026-01-05,NETFLIX.COM,-${amount}`,
    `2026-02-05,NETFLIX.COM,-${amount}`,
    `2026-03-05,NETFLIX.COM,-${amount}`,
  ].join("\n");
}

async function uploadAndReachReview(page: import("@playwright/test").Page, csv: string) {
  await page.goto("/subscriptions/import");
  await page.getByRole("button", { name: "Select" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "netflix.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/possible duplicate/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Review details" }).click();
}

test.describe("import review — possible price change", () => {
  test("accepting the proposal updates the existing subscription's price and records real history", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-import-price-accept");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);
    const subscriptionId = (created.body as { subscription: { id: string } }).subscription.id;

    await uploadAndReachReview(user.page, csvFor("19.99"));

    const row = user.page.getByRole("row", { name: /Netflix/ });
    await expect(row.getByLabel(/Possible duplicate/i)).toBeVisible();
    await expect(user.page.getByText("Possible price change")).toBeVisible();
    await expect(user.page.getByText(/\$15\.99.*tracked/i)).toBeVisible();
    await expect(user.page.getByText(/\$19\.99.*detected/i)).toBeVisible();

    // The row itself must never be pre-selected as a new subscription — the
    // real regression this whole feature exists to prevent (a
    // price-changed subscription silently becoming a second, duplicate
    // one).
    const checkbox = row.getByRole("checkbox", { name: /^Select/ });
    await expect(checkbox).not.toBeChecked();

    // Accessible name is the fuller aria-label (accessibility review fix),
    // not the plain visible text — a screen-reader user navigating a
    // buttons-only list needs the subscription name/amount in the name
    // itself, since every proposal row's *visible* text is identically
    // "Update price".
    await user.page.getByRole("button", { name: /Update Netflix's price/i }).click();
    await expect(user.page.getByText(/price updated/i)).toBeVisible({ timeout: 10_000 });
    // The proposal itself disappears once resolved; the row falls back to
    // its normal ignored/ non-selectable state.
    await expect(user.page.getByText("Possible price change")).not.toBeVisible();

    const updated = await apiFetch(user.page, `/api/subscriptions/${subscriptionId}`);
    expect((updated.body as { subscription: { amountCents: number } }).subscription.amountCents).toBe(1999);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // Release-review finding: a row carrying an unresolved price-change
  // proposal must never be selectable for the create batch (see
  // review-table.tsx's isBlockedByUnresolvedProposal) — otherwise Confirm
  // could both leave the proposal dangling AND create a brand-new,
  // duplicate subscription for a charge already tracked under a different
  // price. The checkbox is disabled outright while the proposal is
  // pending, and resolving it (either button) folds the row into the
  // ignored set, so it stays disabled and unchecked afterward too.
  test("a row with an unresolved price-change proposal can't be selected for the create batch, before or after resolving it", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-import-price-selected");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);

    await uploadAndReachReview(user.page, csvFor("19.99"));

    const row = user.page.getByRole("row", { name: /Netflix/ });
    const checkbox = row.getByRole("checkbox", { name: /^Select/ });
    // Disabled from the moment the proposal appears — never checkable
    // while it's still pending.
    await expect(checkbox).toBeDisabled();
    await expect(checkbox).not.toBeChecked();

    // Accessible name is the fuller aria-label (accessibility review fix),
    // not the plain visible text — a screen-reader user navigating a
    // buttons-only list needs the subscription name/amount in the name
    // itself, since every proposal row's *visible* text is identically
    // "Update price".
    await user.page.getByRole("button", { name: /Update Netflix's price/i }).click();
    await expect(user.page.getByText(/price updated/i)).toBeVisible({ timeout: 10_000 });

    // Still visible (now ignored, not selected) — not removed from the
    // table — and still unchecked and disabled, proving it can never
    // reach the create-batch selection.
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();

    // Regression (CodeRabbit review): resolving a proposal must be
    // terminal. Clicking the row's own Restore button (the same X/Restore
    // control a plain "Ignore" uses) must not un-ignore an already-resolved
    // row — that would silently re-enable its checkbox with no proposal or
    // warning shown again, letting the user select and confirm a brand-new,
    // duplicate subscription for a charge whose price was already updated.
    await row.getByRole("button", { name: /^Restore/ }).click();
    await expect(checkbox).toBeDisabled();
    await expect(checkbox).not.toBeChecked();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("keeping the existing price never touches the subscription and dismisses the proposal", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-import-price-reject");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);
    const subscriptionId = (created.body as { subscription: { id: string } }).subscription.id;

    await uploadAndReachReview(user.page, csvFor("19.99"));
    await expect(user.page.getByText("Possible price change")).toBeVisible();

    await user.page.getByRole("button", { name: /Keep Netflix at its existing price/i }).click();
    await expect(user.page.getByText("Possible price change")).not.toBeVisible();

    // Never silently modified — the existing subscription's price is
    // exactly what it was before this import ran.
    const stillOriginal = await apiFetch(user.page, `/api/subscriptions/${subscriptionId}`);
    expect((stillOriginal.body as { subscription: { amountCents: number } }).subscription.amountCents).toBe(1599);

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("an exact-price match still shows the plain duplicate flag with no price-change proposal", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-import-price-nochange");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);

    await uploadAndReachReview(user.page, csvFor("15.99"));
    await expect(user.page.getByText("Possible price change")).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
