import { describe, it, expect, beforeEach, afterEach } from "vitest";
import robots from "./robots";

// No dedicated coverage existed for robots.ts before this — added
// specifically because this ASO/SEO pass changed its disallow list
// (/notifications was missing, the same class of oversight already fixed
// once for /savings and /analytics per that file's own comment) and
// nothing pinned the full list against regressing the same way again.
describe("robots", () => {
  const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  it("disallows every requireUser()-gated (app) route, not just some of them", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = rules?.disallow;
    const disallowList = Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];

    for (const gatedRoute of ["/dashboard", "/settings", "/subscriptions", "/savings", "/analytics", "/notifications"]) {
      expect(disallowList).toContain(gatedRoute);
    }
  });

  it("allows public marketing pages via the root allow rule", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules?.allow).toBe("/");
  });

  it("disallows every API route", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = rules?.disallow;
    const disallowList = Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];
    expect(disallowList).toContain("/api/");
  });

  describe("sitemap pointer", () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_APP_URL;
    });

    it("omits the sitemap field when no real domain is configured (never points at localhost)", () => {
      const result = robots();
      expect(result.sitemap).toBeUndefined();
    });

    it("points at the real domain's sitemap.xml once one is configured", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
      const result = robots();
      expect(result.sitemap).toBe("https://example.com/sitemap.xml");
    });
  });
});
