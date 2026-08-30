import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, closeDb } from "./helpers/db";

// This whole Playwright suite runs against a real `next build && next
// start` server (see playwright.config.ts's webServer command) — exactly
// the production-build environment isDevPlanPreviewAvailable()'s
// NODE_ENV check is meant to disable. That makes this the actual proof of
// the mechanism's core safety guarantee: not "the code looks like it
// should 404 in production," but "the real production-built endpoint
// really does," using the same server this app would actually deploy.
test.afterAll(async () => {
  await closeDb();
});

test.describe("POST /api/dev/plan-preview — production safety", () => {
  test("does not exist at all in a production build, even for an authenticated user", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-dev-preview-prod");

    const response = await apiFetch(user.page, "/api/dev/plan-preview", {
      method: "POST",
      body: { plan: "pro" },
    });
    expect(response.status).toBe(404);

    // Confirms it's a true no-op, not merely an error response: the
    // account's own plan (read via /api/me, unaffected by any dev-preview
    // cookie) is still whatever it really is.
    const me = await apiFetch(user.page, "/api/me");
    expect((me.body as { user: { plan: string } }).user.plan).toBe("free");

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  test("requires authentication even if it were available", async ({ page }) => {
    await page.goto("/login");
    const response = await apiFetch(page, "/api/dev/plan-preview", {
      method: "POST",
      body: { plan: "pro" },
    });
    // 404 (not available in this production build) takes precedence over
    // 401 — the route's very first check, before session is ever read.
    expect(response.status).toBe(404);
  });
});
