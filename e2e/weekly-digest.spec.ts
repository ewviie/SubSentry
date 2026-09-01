import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { deleteTestUser } from "./helpers/db";

// Retention pass: weekly-digest E2E coverage, mirroring
// renewal-reminders.spec.ts's own split (send/candidate/spend-delta logic
// already has precise DB-integration coverage in
// src/lib/subscriptions/weekly-digest-job.db.test.ts — what only a real
// browser proves is covered here: the Settings toggle persisting through a
// real page load, now default-checked since weeklyDigestEnabled defaults to
// true (schema.ts), and the unsubscribe link's public page rendering
// correctly for an untrusted/invalid token).
test.describe("weekly digest", () => {
  test("Settings — weekly digest defaults on for a new signup and the toggle persists across a reload", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-digest-toggle");

    await user.page.goto("/settings");
    const toggle = user.page.getByRole("checkbox", { name: "Weekly digest" });
    // Retention pass: opt-out, not opt-in, for a new signup — see
    // users.weeklyDigestEnabled's own schema comment for why.
    await expect(toggle).toBeChecked();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();

    await user.page.reload();
    await expect(user.page.getByRole("checkbox", { name: "Weekly digest" })).not.toBeChecked();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("unsubscribe link — an invalid/tampered token shows the invalid-link page with digest-specific copy", async ({ page }) => {
    await page.goto(`/api/notifications/digest/unsubscribe?u=${crypto.randomUUID()}&t=not-a-real-token`);
    await expect(page).toHaveURL(/\/unsubscribed\?ok=0&kind=digest$/);
    await expect(page.getByText("Link invalid or expired")).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to Settings" })).toBeVisible();
  });

  test("unsubscribe link — a malformed user id is rejected before any DB lookup", async ({ page }) => {
    await page.goto(`/api/notifications/digest/unsubscribe?u=not-a-uuid&t=whatever`);
    await expect(page).toHaveURL(/\/unsubscribed\?ok=0&kind=digest$/);
  });
});
