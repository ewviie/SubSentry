import { test, expect } from "@playwright/test";

// Regression coverage for a real bug found while investigating the
// original "dark mode doesn't apply on static pages" audit finding: the
// actual root cause was much bigger than dark mode. proxy.ts issues a
// fresh CSP nonce per request and stamps it onto every <script> Next.js
// renders — but only for a page rendered in that request's own context.
// /terms, /privacy, /guides/how-to-find-forgotten-subscriptions, and
// /subscription-cost-calculator were statically prerendered, so their
// cached HTML shipped with no nonce (or a stale one) on every script tag.
// With no 'unsafe-inline' in this app's CSP, the browser silently refused
// to run any of them — React never hydrated on these pages at all, not
// just next-themes. Verified directly against a real production build
// (globalThis.TURBOPACK never populated, zero React fiber keys anywhere
// in the DOM) before the fix; these tests prove hydration, theming, and
// real interactivity all work now that the pages are `force-dynamic`.
const AFFECTED_PAGES = [
  "/terms",
  "/privacy",
  "/guides/how-to-find-forgotten-subscriptions",
  "/subscription-cost-calculator",
];

test.describe("static public pages actually hydrate", () => {
  for (const path of AFFECTED_PAGES) {
    test(`${path}: every script tag's nonce matches this request's own CSP header`, async ({ page }) => {
      const response = await page.goto(path);
      const csp = response?.headers()["content-security-policy"] ?? "";
      const headerNonceMatch = csp.match(/'nonce-([^']+)'/);
      expect(headerNonceMatch, "response must carry a CSP nonce").not.toBeNull();
      const headerNonce = headerNonceMatch![1];

      // Every rendered <script src> must carry that exact nonce — a stale
      // or missing one is exactly what silently blocked hydration before
      // this fix, with no visible error to a user (only a CSP violation
      // in the browser's own console, easy to miss).
      //
      // .nonce (the IDL property), not getAttribute("nonce") — browsers
      // deliberately return "" from getAttribute for a parsed element's
      // nonce content attribute (so a same-origin script can't read
      // another <script> tag's nonce off the DOM and reuse it); the IDL
      // property still exposes it for legitimate same-page reads like
      // this one.
      const scriptNonces = await page.$$eval("script[src]", (nodes) =>
        nodes.map((n) => (n as HTMLScriptElement).nonce),
      );
      expect(scriptNonces.length).toBeGreaterThan(0);
      for (const nonce of scriptNonces) {
        expect(nonce).toBe(headerNonce);
      }
    });

    test(`${path}: React actually hydrates (not just present in server HTML)`, async ({ page }) => {
      await page.goto(path);
      // waitForFunction, not an immediate check — hydration finishes
      // asynchronously after the 'load' event page.goto() already waits
      // for, so an immediate read can race a genuinely-working page into
      // a false failure. This is exactly the property that was actually
      // broken before the fix (it never became true, no matter how long
      // you waited), so a bounded wait here is still a meaningful test,
      // not a weakened one.
      await page.waitForFunction(
        () =>
          typeof (globalThis as unknown as { TURBOPACK?: unknown }).TURBOPACK !== "undefined" &&
          Object.keys(document.documentElement).some((k) => k.startsWith("__react")),
        { timeout: 5000 },
      );
    });
  }

  test("dark system preference is honored on a static page (was previously stuck light)", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/terms");
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(isDark).toBe(true);
    await context.close();
  });

  test("light system preference is honored on a static page", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/terms");
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(isDark).toBe(false);
    await context.close();
  });

  test("an explicit stored theme preference overrides system preference on a static page", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    // addInitScript, not a post-navigation page.evaluate + reload — this
    // runs before any of the page's own scripts, so next-themes' inline
    // bootstrap script sees the stored preference on its very first
    // (only) run, the same real-world sequence a returning visitor with a
    // previously-set preference actually goes through.
    await context.addInitScript(() => localStorage.setItem("theme", "light"));
    const page = await context.newPage();
    await page.goto("/terms");
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    expect(htmlClass).toContain("light");
    expect(htmlClass).not.toContain(" dark");
    await context.close();
  });

  test("the subscription cost calculator is genuinely interactive, not just server-rendered text", async ({ page }) => {
    await page.goto("/subscription-cost-calculator");
    await page.getByPlaceholder("Netflix").fill("Netflix");
    // The amount field's placeholder is "15.99" — this asserts the real,
    // final displayed total, not just that the input accepted keystrokes,
    // which is exactly the check that would have caught this bug (typing
    // worked fine before the fix too; only the computed result never
    // updated because React never hydrated to run the calculation).
    const amountInput = page.locator('input[placeholder="15.99"]').first();
    await amountInput.fill("15.99");
    await expect(page.getByText("$15.99", { exact: true })).toBeVisible();
    // exact: true — "$191.88" also appears inside "$191.88/year" further
    // down the page (the results-summary sentence), which is a second,
    // legitimate real match, not a bug; this asserts the yearly-total
    // stat specifically.
    await expect(page.getByText("$191.88", { exact: true })).toBeVisible();
  });
});
