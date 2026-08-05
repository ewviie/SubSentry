import type { Browser, Page } from "@playwright/test";
import { uniqueEmail, getRawVerificationTokenForEmail } from "./db";

export interface TestUser {
  email: string;
  password: string;
  page: Page;
}

let syntheticIpCounter = 0;

// Full signup -> verify -> login for one fresh user in a brand-new browser
// context, so two calls in the same test never share cookies/session state
// — the exact isolation an IDOR test needs between "attacker" and "victim".
export async function createVerifiedUser(browser: Browser, emailPrefix: string): Promise<TestUser> {
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
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `10.0.0.${syntheticIpCounter}` },
  });
  const page = await context.newPage();

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForSelector("text=Check your email");

  const rawToken = await getRawVerificationTokenForEmail(email);
  await page.goto(`/verify-email?token=${rawToken}`);
  await page.waitForURL(/\/dashboard$/, { timeout: 5000 });

  return { email, password, page };
}
