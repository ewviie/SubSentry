import type { Browser, Page, ViewportSize } from "@playwright/test";
import { uniqueEmail } from "./db";

export interface TestUser {
  email: string;
  password: string;
  page: Page;
}

let syntheticIpCounter = 0;

// Signup for one fresh user in a brand-new browser context, so two calls in
// the same test never share cookies/session state — the exact isolation an
// IDOR test needs between "attacker" and "victim". Named createVerifiedUser
// (not createUser) because every caller in this suite still just wants "a
// logged-in user" regardless of the name — kept as-is rather than a
// rename-only churn across every spec file that imports it. Signup logs
// the user straight in now: email verification is disabled in the active
// auth flow (see api/auth/signup/route.ts), though the underlying
// implementation and its own e2e coverage (verify-email's standalone
// token-handling behavior) are kept intact for a future re-enable.
export async function createVerifiedUser(
  browser: Browser,
  emailPrefix: string,
  options?: { viewport?: ViewportSize },
): Promise<TestUser> {
  const email = uniqueEmail(emailPrefix);
  const password = "a-strong-password-123";
  // Every request from this test suite hits the server directly (no real
  // reverse proxy), so getClientIp() sees no x-forwarded-for header at all
  // and every signup collapses into the single shared "unknown" IP bucket
  // — checkSignupRateLimit's real 5/hour cap, correctly doing its job,
  // otherwise starts rejecting this suite's own test signups by its 6th
  // call. Giving each simulated user a distinct synthetic IP is the
  // realistic fix (real distinct users would have distinct IPs too), not a
  // reason to loosen the app's actual rate limit.
  syntheticIpCounter += 1;
  // viewport is opt-in and passed straight to newContext — this helper
  // creates its own context (not the test fixture's default one), so a
  // plain `test.use({ viewport })` never reaches it on its own; genuine
  // mobile-viewport tests (mobile-overflow.spec.ts) need this to actually
  // land at the requested size, not fall back to Playwright's desktop
  // default.
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `10.0.0.${syntheticIpCounter}` },
    ...(options?.viewport ? { viewport: options.viewport } : {}),
  });
  const page = await context.newPage();

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  // Required consent checkbox (see signup-form.tsx) — the submit button
  // stays disabled without it, same as a real user would have to check it.
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 5000 });

  return { email, password, page };
}
