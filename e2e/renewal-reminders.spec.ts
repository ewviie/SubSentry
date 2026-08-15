import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser } from "./helpers/db";

// Phase 5 (renewal reminders) E2E coverage. Deliberately does NOT send or
// mock a real email through this suite — the send path (claim, SMTP call,
// mark-sent, idempotency, concurrency, failure handling) already has
// dedicated, more precise coverage against a real Postgres instance in
// src/lib/subscriptions/renewal-reminders.db.test.ts (with the SMTP
// transport itself mocked there, not sent for real either — see that
// file's own comment). What only a real browser can prove is covered here
// instead: the Settings toggle actually persisting through a real page
// load, the unsubscribe link's public page rendering correctly for an
// untrusted/invalid token, the cron endpoint's fail-closed behavior against
// the real deployed route, and the "arrive from a reminder" journey
// landing on a working, existing subscription detail page.
test.describe("renewal reminders", () => {
  test("Settings — renewal reminder toggle persists across a reload", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-reminder-toggle");

    await user.page.goto("/settings");
    const toggle = user.page.getByRole("checkbox", { name: "Renewal reminder emails" });
    // Opt-out, not opt-in — see users.renewalRemindersEnabled's own schema
    // comment for why the default is true.
    await expect(toggle).toBeChecked();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    // Wait for the in-flight PATCH + router.refresh() the click kicked off
    // to fully settle (the toggle re-enables in its `finally`, see
    // renewal-reminder-toggle.tsx) before forcing a fresh navigation below
    // — reloading while that request is still in flight would fire two
    // concurrent requests at the single local dev DB connection, an
    // unrelated PGlite-dev-only concurrency limitation (see db/index.ts's
    // own comment on it) that has nothing to do with what this test is
    // actually verifying.
    await expect(toggle).toBeEnabled();

    await user.page.reload();
    await expect(user.page.getByRole("checkbox", { name: "Renewal reminder emails" })).not.toBeChecked();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("unsubscribe link — an invalid/tampered token shows the invalid-link page, not a server error", async ({ page }) => {
    await page.goto(`/api/renewal-reminders/unsubscribe?u=${crypto.randomUUID()}&t=not-a-real-token`);
    await expect(page).toHaveURL(/\/unsubscribed\?ok=0$/);
    await expect(page.getByText("Link invalid or expired")).toBeVisible();
    // Rendered as a Button (role=button) wrapping a Link under the hood —
    // same polymorphic-render pattern verify-email-content.tsx's own "Back
    // to log in" control uses, not a plain <a>.
    await expect(page.getByRole("button", { name: "Go to Settings" })).toBeVisible();
  });

  test("unsubscribe link — a malformed user id is rejected before any DB lookup", async ({ page }) => {
    await page.goto(`/api/renewal-reminders/unsubscribe?u=not-a-uuid&t=whatever`);
    await expect(page).toHaveURL(/\/unsubscribed\?ok=0$/);
  });

  test("cron job endpoint — fails closed rather than running for an unauthenticated caller", async ({ page }) => {
    // This sandbox ships with CRON_SECRET unset (see .env.example's own
    // documentation of it) — confirming this to be an accurate, not
    // fabricated, statement about the *deployed* state is exactly the
    // point of this test: the endpoint must never silently "work anyway"
    // for anyone who happens to call it. If CRON_SECRET is ever configured
    // in this environment, this test's plausible outcome (401 instead of
    // 503) is asserted too rather than treated as a failure — either
    // response proves the same thing: no anonymous caller ever reaches the
    // job.
    // apiFetch runs fetch() inside the page's own context — needs a
    // same-origin document loaded first, same as every other apiFetch call
    // site in this suite (they all call it on an already-`goto`'d page).
    await page.goto("/login");
    const unauthed = await apiFetch(page, "/api/cron/renewal-reminders", { method: "POST" });
    expect([401, 503]).toContain(unauthed.status);

    const wrongToken = await page.evaluate(async () => {
      const res = await fetch("/api/cron/renewal-reminders", {
        method: "POST",
        headers: { Authorization: "Bearer definitely-not-the-real-secret" },
      });
      return res.status;
    });
    expect([401, 503]).toContain(wrongToken);
  });

  test("deep link from a reminder lands on the subscription's own detail page with the existing Keep/edit/cancel actions", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-reminder-deeplink");

    const nearRenewal = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: nearRenewal },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { subscription: { id: string } }).subscription.id;

    // The exact URL sendRenewalReminderEmail's "Review subscription" button
    // points at (buildSubscriptionUrl) — no separate landing route, no new
    // routing complexity, per the brief's own instruction to reuse the
    // existing subscription detail route rather than build a new one.
    await user.page.goto(`/subscriptions/${id}`);

    await expect(user.page.getByRole("heading", { name: "Netflix" })).toBeVisible();
    await expect(user.page.getByLabel("Amount")).toHaveValue("15.99");
    // SubscriptionSummary's "Next renewal" stat — the same raw
    // nextRenewalDate value the reminder email's own subject/body derive
    // "renews on {date}" from (formatRenewalDate in renewal-reminders.ts),
    // never a second, independently-typed-out date.
    await expect(user.page.getByText(nearRenewal)).toBeVisible();

    // Existing actions, not new ones built for this phase: Keep = do
    // nothing / Save changes; Investigate = the editable form fields
    // already on this page; Cancel = the Status field (settable to
    // Canceled) plus the danger-zone delete control.
    await expect(user.page.getByRole("button", { name: "Save changes" })).toBeVisible();
    // exact: true — a loose substring match against "Status" also matches
    // the Phase 6 cancellation-guidance paragraph's own "...status field
    // above..." wording (getByText is case-insensitive by default), which
    // isn't the Status *field* this assertion means to check for.
    await expect(user.page.getByText("Status", { exact: true })).toBeVisible();
    await expect(user.page.getByRole("button", { name: "Delete subscription" })).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
