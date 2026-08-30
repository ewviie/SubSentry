import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

// Data export is a Free-tier feature (see lib/subscriptions/export.ts's own
// comment) — no plan check anywhere in this flow, unlike every Premium
// surface elsewhere in this suite. Coverage here is about correctness and
// ownership, not entitlement.
test.afterAll(async () => {
  await closeDb();
});

async function fetchCsv(page: import("@playwright/test").Page, url: string) {
  return page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, contentType: res.headers.get("content-type"), text: await res.text() };
  }, url);
}

test.describe("GET /api/subscriptions/export", () => {
  test("requires authentication", async ({ page }) => {
    await page.goto("/login");
    const response = await fetchCsv(page, "/api/subscriptions/export");
    expect(response.status).toBe(401);
  });

  test("returns a real CSV of only the caller's own subscriptions, with the header row present even when empty", async ({
    browser,
  }) => {
    const owner = await createVerifiedUser(browser, "e2e-export-owner");
    const other = await createVerifiedUser(browser, "e2e-export-other");

    const created = await apiFetch(owner.page, "/api/subscriptions", {
      method: "POST",
      body: { name: "Netflix", amount: "15.99", billingCycle: "monthly", nextRenewalDate: "2099-01-01" },
    });
    expect(created.status).toBe(201);

    const ownerCsv = await fetchCsv(owner.page, "/api/subscriptions/export");
    expect(ownerCsv.status).toBe(200);
    expect(ownerCsv.contentType).toContain("text/csv");
    expect(ownerCsv.text).toContain("Netflix");
    expect(ownerCsv.text).toContain("15.99");

    // The other user's own export must never contain the owner's row —
    // this endpoint has no id parameter to guess (it always reads the
    // authenticated caller's own data), but a regression that dropped the
    // userId scope from the underlying query would still show up here.
    const otherCsv = await fetchCsv(other.page, "/api/subscriptions/export");
    expect(otherCsv.status).toBe(200);
    expect(otherCsv.text).not.toContain("Netflix");
    expect(otherCsv.text.trim().split("\n")).toHaveLength(1); // header only

    await owner.page.context().close();
    await other.page.context().close();
    await deleteTestUser(owner.email);
    await deleteTestUser(other.email);
  });
});
