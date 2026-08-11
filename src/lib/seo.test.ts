import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAppUrl, absoluteUrl } from "./seo";

// Pure unit tests, no DB needed — getAppUrl()/absoluteUrl() only ever read
// process.env.NEXT_PUBLIC_APP_URL. This is also the regression coverage for
// the CodeRabbit finding that led to getAppUrl() existing: previously every
// call site (layout.tsx, sitemap.ts, robots.ts, absoluteUrl() itself) ran
// its own `new URL(raw)` on the unvalidated env var, which would have
// thrown uncaught on a malformed value.
describe("getAppUrl", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it("returns undefined when unset", () => {
    expect(getAppUrl()).toBeUndefined();
  });

  it("returns undefined for a malformed value, instead of throwing", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url";
    expect(() => getAppUrl()).not.toThrow();
    expect(getAppUrl()).toBeUndefined();
  });

  it("returns undefined for a non-http(s) scheme", () => {
    process.env.NEXT_PUBLIC_APP_URL = "ftp://subsentry.app";
    expect(getAppUrl()).toBeUndefined();
  });

  it("returns the raw value for a well-formed https URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://subsentry.app";
    expect(getAppUrl()).toBe("https://subsentry.app");
  });

  it("accepts http (not just https), same as new URL() would", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(getAppUrl()).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it("returns undefined when NEXT_PUBLIC_APP_URL is unset", () => {
    expect(absoluteUrl("/login")).toBeUndefined();
  });

  it("returns undefined (not a throw) when NEXT_PUBLIC_APP_URL is malformed", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url";
    expect(() => absoluteUrl("/login")).not.toThrow();
    expect(absoluteUrl("/login")).toBeUndefined();
  });

  it("joins the path against a well-formed base", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://subsentry.app";
    expect(absoluteUrl("/login")).toBe("https://subsentry.app/login");
  });
});
