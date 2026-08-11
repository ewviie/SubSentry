import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Regression coverage for the Product Polish pass's #2 fix: a CSV import
// that detects zero recurring subscriptions used to leave the user on a
// bare sentence with no way back into the flow short of abandoning it
// entirely. A single one-off transaction (detection.ts requires 3+
// occurrences before anything counts as "recurring" — see
// MIN_OCCURRENCES_FOR_INTRO_DETECTION) reliably produces the zero-result
// case without depending on the detection heuristics' exact matching rules.
const ONE_OFF_TRANSACTION_CSV = "Date,Description,Amount\n2026-07-10,ONE OFF PURCHASE,42.00\n";

test.describe("import flow — zero detected subscriptions", () => {
  test("offers a way back to Upload instead of stranding the user", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-import-zero");

    await user.page.goto("/subscriptions/import");
    await user.page.getByRole("button", { name: "Select" }).first().click();

    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "one-off.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(ONE_OFF_TRANSACTION_CSV),
    });

    // Lands on Review with nothing detected.
    await expect(user.page.getByText("No recurring subscriptions detected")).toBeVisible({ timeout: 10_000 });

    // The actual regression: a real, clickable recovery action — not a
    // dead-end sentence.
    const tryAgain = user.page.getByRole("button", { name: "Try a different file" });
    await expect(tryAgain).toBeVisible();
    await tryAgain.click();

    // Back on Upload, for the same source (Bank CSV) — not bounced all the
    // way back to re-choosing a source.
    await expect(user.page.getByText("Upload your Bank CSV file")).toBeVisible();
    await expect(user.page.locator('input[type="file"]')).toBeAttached();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
