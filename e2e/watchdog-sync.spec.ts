import { test, expect } from "@playwright/test";
import { apiFetch } from "./helpers/api";

// Watchdog phase E2E coverage. The sync job's own real-DB behavior (idempotent
// price-change auto-apply, per-account failure isolation, unusual-charge
// flagging) is already covered against a real Postgres instance in
// src/lib/imports/connected-account-sync-job.db.test.ts. What only a real
// browser/deployed-route test can prove is covered here instead: the new
// cron endpoint's fail-closed behavior, same posture
// renewal-reminders.spec.ts's own cron test already establishes for the
// other two scheduled jobs.
test.describe("watchdog automatic sync", () => {
  test("cron job endpoint — fails closed rather than running for an unauthenticated caller", async ({ page }) => {
    // Same "CRON_SECRET unset in this sandbox" reasoning
    // renewal-reminders.spec.ts's own cron test documents — either a 503
    // (not configured) or a 401 (configured but no/wrong token) proves the
    // same thing: no anonymous caller ever reaches the job.
    await page.goto("/login");
    const unauthed = await apiFetch(page, "/api/cron/sync-connected-accounts", { method: "POST" });
    expect([401, 503]).toContain(unauthed.status);
  });
});
