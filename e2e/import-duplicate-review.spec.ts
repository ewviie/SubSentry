import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Phase 7 fix: detectRecurringSubscriptions() (lib/imports/detection.ts)
// already computes isDuplicateOfExistingId - a fuzzy match against the
// user's own existing subscriptions - but the review table (where the
// actual per-row import decision happens) never surfaced it. A
// high-confidence detection of something the user already tracks was
// pre-selected by default and could be silently re-imported as a second,
// real, recurring charge. See review-table.tsx's isPreselectedByDefault
// and review-row.tsx's duplicate badge.
// Negative amounts: csv-parser.ts's Bank CSV path (csv-bank-provider.ts,
// unlike Apple/Google Play's own providers) has no defaultDirection
// override, so a plain positive amount with no sign and no separate
// debit/credit/type column defaults to "credit" (money in) and gets
// filtered out entirely before clustering — a real bank export signals a
// debit (money out) with a leading "-", which is what this test needs to
// actually reach detection.
const NETFLIX_CSV = [
  "Date,Description,Amount",
  "2026-01-05,NETFLIX.COM,-15.99",
  "2026-02-05,NETFLIX.COM,-15.99",
  "2026-03-05,NETFLIX.COM,-15.99",
].join("\n");

test.describe("import review — duplicate of an existing subscription", () => {
  test("is flagged with a visible badge and not pre-selected, even at high confidence", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-import-dup-review");

    // The existing subscription the detected Netflix cluster should match.
    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);

    await user.page.goto("/subscriptions/import");
    await user.page.getByRole("button", { name: "Select" }).first().click();

    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "netflix.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(NETFLIX_CSV),
    });

    // Reveal screen already tells the user about this in aggregate.
    await expect(user.page.getByText(/possible duplicate/i)).toBeVisible({ timeout: 10_000 });
    await user.page.getByRole("button", { name: "Review details" }).click();

    // The actual regression: the specific row must be flagged AND not
    // pre-selected, even though a known-merchant match ("Netflix") would
    // otherwise be high confidence and pre-selected by default.
    const row = user.page.getByRole("row", { name: /Netflix/ });
    await expect(row.getByLabel(/Possible duplicate/i)).toBeVisible();
    const checkbox = row.getByRole("checkbox", { name: /^Select/ });
    await expect(checkbox).not.toBeChecked();

    // Still fully overridable — nothing is force-hidden or disabled.
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
