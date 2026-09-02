import { test, expect } from "@playwright/test";

// ASO/SEO pass coverage — the homepage and the two most closely related
// public pages had zero e2e coverage of their own metadata/content before
// this. Deliberately environment-agnostic about NEXT_PUBLIC_APP_URL (this
// suite runs with it unset, same as every other environment that hasn't
// configured a real domain yet — see lib/seo.ts's own comment): canonical
// assertions check the tag exists and resolves correctly relative to the
// current origin, never assume an absolute production URL is present.
test.describe("Homepage — metadata and positioning", () => {
  test("title leads with the category, not the mechanism", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("SubSentry: Subscription Tracker & Spend Manager");
  });

  test("a canonical link tag is present and resolves to the homepage", async ({ page }) => {
    await page.goto("/");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", /\/$/);
  });

  test("the hero eyebrow badge names the category before AI, not the other way around", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Subscription tracking — AI-powered")).toBeVisible();
    await expect(page.getByText("AI-powered subscription tracking")).not.toBeVisible();
  });

  test("the hero headline is unchanged — the single strongest line on the site", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Know exactly what you're paying for." })).toBeVisible();
  });

  test("the FAQ answers whether SubSentry can actually save money and whether it cancels subscriptions", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "How much can SubSentry actually save me?" }).click();
    await expect(page.getByText(/permanent record of what it saved you/)).toBeVisible();

    await page.getByRole("button", { name: "Does SubSentry cancel my subscriptions for me?" }).click();
    await expect(page.getByText(/can't cancel anything on your behalf/)).toBeVisible();
  });

  test("the two new FAQ entries are present in the page's own FAQPage structured data, not just the visible accordion", async ({ page }) => {
    await page.goto("/");
    const jsonLdBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const faqBlock = jsonLdBlocks.map((b) => JSON.parse(b)).find((d) => d["@type"] === "FAQPage");
    expect(faqBlock).toBeDefined();
    const questions = faqBlock.mainEntity.map((q: { name: string }) => q.name);
    expect(questions).toContain("How much can SubSentry actually save me?");
    expect(questions).toContain("Does SubSentry cancel my subscriptions for me?");
  });

  test("the Free tier states the permanent realized-savings record, not just spend tracking", async ({ page }) => {
    await page.goto("/");
    const freeCard = page.locator("text=SubSentry Free").locator("..").locator("..");
    await expect(freeCard.getByText("Permanent record of what you've canceled and saved")).toBeVisible();
  });

  test("no unsupported financial claims: no guaranteed/automatic savings language anywhere on the page", async ({ page }) => {
    await page.goto("/");
    const bodyText = await page.locator("body").innerText();
    for (const overclaim of [/guaranteed savings/i, /automatically cancel/i, /financial advice/i]) {
      expect(bodyText).not.toMatch(overclaim);
    }
  });
});

test.describe("Subscription tracker page — metadata and content", () => {
  test("has its own unique title and canonical, distinct from the homepage", async ({ page }) => {
    await page.goto("/subscription-tracker");
    // root layout's title.template ("%s | SubSentry") applies here, unlike
    // the homepage's own `{ absolute }` title (see page.tsx's own comment
    // on why the homepage opts out of the template).
    await expect(page).toHaveTitle("Subscription Tracker: Track Every Recurring Charge | SubSentry");
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", /\/subscription-tracker$/);
  });

  test("its new FAQ entry is distinct from the homepage's savings FAQ, not a duplicate", async ({ page }) => {
    await page.goto("/subscription-tracker");
    await expect(page.getByRole("button", { name: "Will tracking my subscriptions actually save me money?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "How much can SubSentry actually save me?" })).not.toBeVisible();
  });

  test("links to the forgotten-subscriptions guide and cost calculator — real internal links, not a new SEO-only page", async ({ page }) => {
    await page.goto("/subscription-tracker");
    await expect(page.getByRole("link", { name: /guide to finding forgotten subscriptions/ })).toHaveAttribute(
      "href",
      "/guides/how-to-find-forgotten-subscriptions",
    );
    await expect(page.getByRole("link", { name: /free subscription cost calculator/ })).toHaveAttribute(
      "href",
      "/subscription-cost-calculator",
    );
  });
});

test.describe("Forgotten-subscriptions guide — strengthened payoff section", () => {
  test("honestly describes cancellation guidance (a real search link) without ever claiming SubSentry cancels for you", async ({ page }) => {
    await page.goto("/guides/how-to-find-forgotten-subscriptions");
    await expect(page.getByText(/real search link to help you cancel each one/)).toBeVisible();
    await expect(page.getByText(/never cancels anything on your behalf/)).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/automatically cancels?/i);
  });

  test("mentions the permanent realized-savings record as the payoff for following through", async ({ page }) => {
    await page.goto("/guides/how-to-find-forgotten-subscriptions");
    await expect(page.getByText(/permanent record of what you've actually stopped paying for/)).toBeVisible();
  });
});

test.describe("Indexability — authenticated pages stay out of the sitemap and robots allow list", () => {
  test("robots.txt disallows every requireUser()-gated route, including /notifications", async ({ page }) => {
    const response = await page.goto("/robots.txt");
    const body = (await response?.text()) ?? "";
    for (const gatedRoute of ["/dashboard", "/settings", "/subscriptions", "/savings", "/analytics", "/notifications"]) {
      expect(body).toContain(`Disallow: ${gatedRoute}`);
    }
  });

  test("sitemap.xml never lists an authenticated route", async ({ page }) => {
    const response = await page.goto("/sitemap.xml");
    expect(response?.status()).toBe(200);
    const body = (await response?.text()) ?? "";
    for (const gatedRoute of ["/dashboard", "/settings", "/subscriptions", "/savings", "/analytics", "/notifications"]) {
      expect(body).not.toContain(`<loc>`.concat(gatedRoute));
    }
  });

  test("an unauthenticated visitor hitting a gated page never sees its content — /notifications redirects to /login", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/login/);
  });
});
