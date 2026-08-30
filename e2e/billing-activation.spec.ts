import { test, expect } from "@playwright/test";
import { createVerifiedUser } from "./helpers/auth";
import { apiFetch } from "./helpers/api";
import { deleteTestUser, insertTestCheckoutSession, deleteTestCheckoutSession, closeDb } from "./helpers/db";

// P1 production-readiness pass: /api/billing/activate had zero E2E
// coverage of its authorization behavior before this — the ownership check
// (Phase 15's "Payment/subscription security") is exactly the kind of
// check a future refactor could silently weaken with nothing to catch it.
// There's no live Stripe test-mode integration in this suite to trigger a
// real checkout.session.completed webhook, so insertTestCheckoutSession
// seeds the same row that webhook write produces, isolating exactly the
// activate route's own logic (ownership, idempotency, auth) from Stripe
// connectivity.
test.afterAll(async () => {
  await closeDb();
});

async function currentUserId(page: import("@playwright/test").Page): Promise<string> {
  const me = await apiFetch(page, "/api/me");
  return (me.body as { user: { id: string } }).user.id;
}

test.describe("POST /api/billing/activate — authorization", () => {
  test("requires authentication", async ({ page }) => {
    await page.goto("/login");
    const response = await apiFetch(page, "/api/billing/activate", {
      method: "POST",
      body: { checkoutSessionId: "cs_does_not_matter" },
    });
    expect(response.status).toBe(401);
  });

  test("a nonexistent checkout session id returns 404, not a crash", async ({ browser }) => {
    const user = await createVerifiedUser(browser, "e2e-activate-404");

    const response = await apiFetch(user.page, "/api/billing/activate", {
      method: "POST",
      body: { checkoutSessionId: "cs_never_existed_12345" },
    });
    expect(response.status).toBe(404);
    expect((response.body as { error: string }).error).toBe("not_found");

    await user.page.context().close();
    await deleteTestUser(user.email);
  });

  // The core IDOR-relevant check: a checkout session recorded (by the real
  // webhook, in production) as belonging to user A must never be claimable
  // by an authenticated user B who happens to learn or guess its id.
  test("a checkout session owned by a different user returns 403, and does not grant Premium", async ({ browser }) => {
    const owner = await createVerifiedUser(browser, "e2e-activate-owner");
    const attacker = await createVerifiedUser(browser, "e2e-activate-attacker");
    const ownerId = await currentUserId(owner.page);
    const checkoutId = `cs_e2e_${Date.now()}_${Math.random()}`;

    await insertTestCheckoutSession(checkoutId, ownerId);

    const crossUserAttempt = await apiFetch(attacker.page, "/api/billing/activate", {
      method: "POST",
      body: { checkoutSessionId: checkoutId },
    });
    expect(crossUserAttempt.status).toBe(403);
    expect((crossUserAttempt.body as { error: string }).error).toBe("forbidden");

    const attackerMe = await apiFetch(attacker.page, "/api/me");
    expect((attackerMe.body as { user: { plan: string } }).user.plan).toBe("free");

    await deleteTestCheckoutSession(checkoutId);
    await owner.page.context().close();
    await attacker.page.context().close();
    await deleteTestUser(owner.email);
    await deleteTestUser(attacker.email);
  });

  test("the real owner can activate their own checkout session, idempotently", async ({ browser }) => {
    const owner = await createVerifiedUser(browser, "e2e-activate-real-owner");
    const ownerId = await currentUserId(owner.page);
    const checkoutId = `cs_e2e_${Date.now()}_${Math.random()}`;

    await insertTestCheckoutSession(checkoutId, ownerId);

    const first = await apiFetch(owner.page, "/api/billing/activate", {
      method: "POST",
      body: { checkoutSessionId: checkoutId },
    });
    expect(first.status).toBe(200);
    expect((first.body as { plan: string }).plan).toBe("pro");

    const me = await apiFetch(owner.page, "/api/me");
    expect((me.body as { user: { plan: string } }).user.plan).toBe("pro");

    // Redeeming the same session again (e.g. a duplicate client-side
    // retry) must not error or behave any differently — it's already
    // activated.
    const second = await apiFetch(owner.page, "/api/billing/activate", {
      method: "POST",
      body: { checkoutSessionId: checkoutId },
    });
    expect(second.status).toBe(200);
    expect((second.body as { plan: string }).plan).toBe("pro");

    await deleteTestCheckoutSession(checkoutId);
    await owner.page.context().close();
    await deleteTestUser(owner.email);
  });

  test("a checkout session with no resolved owner (client_reference_id never matched a user) cannot be claimed by anyone", async ({
    browser,
  }) => {
    const user = await createVerifiedUser(browser, "e2e-activate-unowned");
    const checkoutId = `cs_e2e_${Date.now()}_${Math.random()}`;
    await insertTestCheckoutSession(checkoutId, null);

    const response = await apiFetch(user.page, "/api/billing/activate", {
      method: "POST",
      body: { checkoutSessionId: checkoutId },
    });
    // null !== the authenticated user's own id, so this falls into the
    // same ownership-mismatch branch as a genuinely different owner —
    // there's no special-case that treats "unowned" as "up for grabs".
    expect(response.status).toBe(403);

    await deleteTestCheckoutSession(checkoutId);
    await user.page.context().close();
    await deleteTestUser(user.email);
  });
});
