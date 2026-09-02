import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

test.afterAll(async () => {
  await closeDb();
});

// Product-value pass, round 2: the dashboard's old single-answer
// "Your biggest opportunity" spotlight (savings-only) was replaced by the
// broader "Needs your attention" panel (attention-panel.tsx), which reads
// real, persisted notifications spanning every detection type, not just
// savings. Same real-world scenarios this file always tested, repointed to
// where that intelligence actually surfaces now.
test.describe("Dashboard — Needs your attention", () => {
  test("a confirmed duplicate surfaces in the attention panel", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-biggest-opp-duplicate");

    for (const [name, amount] of [
      ["Netflix", "8.00"],
      ["Netflix Premium", "20.00"], // confirmed duplicate
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    // User Value Journey Audit, opportunity #1 revised: the panel's own
    // description now also names the top finding, so this title
    // legitimately appears twice (description + ranked list below) — .first()
    // asserts "it's there," same reasoning security.spec.ts's own XSS-payload
    // check already documents for an identical "appears in more than one
    // place" case.
    await expect(panel.getByText(/look like duplicates/i).first()).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // Honesty check (the whole point of this product-value pass): three
  // unrelated, freshly-added subscriptions with no genuine issue between
  // them must show the real "nothing to flag" empty state, never a
  // manufactured "look at your priciest subscription" nudge with no actual
  // finding behind it — the old BiggestOpportunityCard's fallback behavior,
  // deliberately not carried forward.
  test("shows the honest empty state when nothing has actually been detected", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-biggest-opp-fallback");

    for (const [name, amount] of [
      ["Adobe Creative Cloud", "60.00"],
      ["Spotify", "10.00"],
      ["Dropbox", "10.00"],
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    await expect(panel.getByText(/all caught up/i)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});

// User Value Journey Audit, opportunity #1 revised: the permanent
// realized-savings total, previously visible only on /savings, now also on
// this exact panel — and the panel's own description now names the top 1-2
// real findings instead of only a bare count.
test.describe("Dashboard — Needs your attention: realized savings and change summary", () => {
  test("canceledCount = 0: no realized-savings line appears", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-attention-no-savings");

    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Spotify", amount: "9.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    await expect(panel.getByText(/you've saved/i)).not.toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("canceledCount > 0: states the real annualized realized-savings total", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-attention-savings");

    // AttentionPanel only renders while the portfolio has at least one
    // active subscription (dashboard/page.tsx's own hasActive gate,
    // unrelated to this feature) — an active Spotify keeps the panel on
    // screen so the realized-savings line has somewhere to render.
    const created = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Hulu", amount: "7.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { subscription: { id: string } }).subscription.id;
    const canceled = await apiFetch(user.page, `/api/subscriptions/${id}`, { method: "PATCH", body: { status: "canceled" } });
    expect(canceled.status).toBe(200);
    await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Spotify", amount: "9.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    // $7.99/mo annualizes to $95.88/yr.
    await expect(panel.getByText(/You've saved \$95\.88\/yr so far, from 1 cancellation/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("mixed-currency realized savings: an honest gap on the dashboard too, never a fabricated total", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-attention-savings-mixed");

    const usd = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Hulu", amount: "7.99", currency: "usd", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    const eur = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Spotify", amount: "9.99", currency: "eur", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    for (const res of [usd, eur]) {
      const id = (res.body as { subscription: { id: string } }).subscription.id;
      const patched = await apiFetch(user.page, `/api/subscriptions/${id}`, { method: "PATCH", body: { status: "canceled" } });
      expect(patched.status).toBe(200);
    }
    // AttentionPanel only renders while the portfolio has at least one
    // active subscription (dashboard/page.tsx's own hasActive gate) — kept
    // active so the panel itself stays on screen.
    await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Dropbox", amount: "9.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    await expect(panel.getByText(/You've saved money from 2 cancellations here \(spanning more than one currency\)/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("with 2 real, independent findings, the description names both via an 'Also:' clause", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-attention-two-findings");

    // Finding 1: a confirmed duplicate (warning severity, real dollar
    // impact). Finding 2: an active subscription whose renewal date is
    // already well in the past (renewal_lapsed fires immediately once
    // overdue by more than the 3-day grace period — no waiting required).
    // Both are real, independently-triggered, persisted notifications.
    for (const [name, amount] of [
      ["Netflix", "8.00"],
      ["Netflix Premium", "20.00"],
    ] as const) {
      const created = await apiFetch(user.page, "/api/subscriptions", {
        method: "POST",
        body: { name, amount, billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
      });
      expect(created.status).toBe(201);
    }
    const lapsed = await apiFetch(user.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Overdue Gym", amount: "30.00", billingCycle: "monthly", nextRenewalDate: "2020-01-01" },
    });
    expect(lapsed.status).toBe(201);

    await user.page.goto("/dashboard");
    const panel = user.page.locator("text=Needs your attention").locator("..").locator("..");
    // The primary (highest-ranked) finding's title appears in the
    // description, AND a real second one via "Also:" — not just the count.
    await expect(panel.getByText(/look like duplicates/i).first()).toBeVisible();
    await expect(panel.getByText(/Also:/)).toBeVisible();

    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
