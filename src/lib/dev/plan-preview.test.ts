import { describe, it, expect, afterEach, vi } from "vitest";

// next/headers' cookies() only works inside a real request scope (a Server
// Component render or Route Handler) — calling it directly in a plain unit
// test throws. Mocked here the same vi.hoisted()/vi.mock() pattern this
// codebase already uses elsewhere (see queries.reactivation.test.ts) so
// getDevPlanPreview()'s own cookie-reading logic can be tested in
// isolation, independent of a real request.
const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

function mockCookieValue(value: string | undefined) {
  cookiesMock.mockResolvedValue({ get: () => (value === undefined ? undefined : { value }) });
}

describe("isDevPlanPreviewAvailable / getDevPlanPreview", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cookiesMock.mockReset();
  });

  // The one property that must never be weakened: this entire mechanism
  // provably does not exist in a real deployment. NODE_ENV=production is
  // set by `next build`/`next start` themselves, never by this app's own
  // code, so this is the actual backstop, not documentation.
  it("is unavailable, and never reads cookies at all, when NODE_ENV is production", async () => {
    const { isDevPlanPreviewAvailable, getDevPlanPreview } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "production");
    mockCookieValue("pro");

    expect(isDevPlanPreviewAvailable()).toBe(false);
    expect(await getDevPlanPreview()).toBeNull();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("is available outside production", async () => {
    const { isDevPlanPreviewAvailable } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevPlanPreviewAvailable()).toBe(true);
  });

  it("returns the cookie's value when it's a real plan", async () => {
    const { getDevPlanPreview } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue("pro");
    expect(await getDevPlanPreview()).toBe("pro");

    mockCookieValue("free");
    expect(await getDevPlanPreview()).toBe("free");
  });

  it("returns null when the cookie is absent", async () => {
    const { getDevPlanPreview } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue(undefined);
    expect(await getDevPlanPreview()).toBeNull();
  });

  it("returns null for a garbage/tampered cookie value rather than trusting it", async () => {
    const { getDevPlanPreview } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue("enterprise");
    expect(await getDevPlanPreview()).toBeNull();
  });
});

// resolveHasPaidAccess/resolveHasReachedSubscriptionLimit are the actual
// integration point every server-only entitlement check now goes through
// instead of calling hasPaidAccess/hasReachedSubscriptionLimit
// (lib/billing/plan.ts) directly — see this file's own top comment. Those
// two functions themselves stay real and unmocked here (they're pure and
// side-effect-free); only the cookie is faked, exactly like the
// getDevPlanPreview tests above.
describe("resolveHasPaidAccess / resolveHasReachedSubscriptionLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cookiesMock.mockReset();
  });

  it("defers to the real (beta-gated) hasPaidAccess when no preview is active", async () => {
    const { resolveHasPaidAccess } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue(undefined);
    // BETA_ALL_ACCESS is on, so even "free" resolves to paid access here —
    // this proves the resolver is genuinely falling through to the real
    // function, not just returning a hardcoded value.
    expect(await resolveHasPaidAccess("free")).toBe(true);
  });

  it("a 'free' preview overrides the beta's unconditional unlock", async () => {
    const { resolveHasPaidAccess } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue("free");
    expect(await resolveHasPaidAccess("pro")).toBe(false);
  });

  it("a 'pro' preview grants paid access regardless of the real plan", async () => {
    const { resolveHasPaidAccess } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue("pro");
    expect(await resolveHasPaidAccess("free")).toBe(true);
  });

  it("a preview is completely inert in a production build, even if a stray cookie is present", async () => {
    const { resolveHasPaidAccess } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "production");
    mockCookieValue("free");
    // Real behavior (beta on) wins — the "free" cookie is never even read.
    expect(await resolveHasPaidAccess("free")).toBe(true);
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  // Proves the dev-preview banner's "Free" button actually re-enforces the
  // 5-subscription cap end to end through this function — not just a
  // cosmetic isPremium flag pages use for display.
  it("resolveHasReachedSubscriptionLimit honors a 'free' preview even for a real pro account", async () => {
    const { resolveHasReachedSubscriptionLimit } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue("free");
    expect(await resolveHasReachedSubscriptionLimit("pro", 5)).toBe(true);
    expect(await resolveHasReachedSubscriptionLimit("pro", 4)).toBe(false);
  });

  it("resolveHasReachedSubscriptionLimit defers to the real function when no preview is active", async () => {
    const { resolveHasReachedSubscriptionLimit } = await import("./plan-preview");
    vi.stubEnv("NODE_ENV", "development");
    mockCookieValue(undefined);
    // BETA_ALL_ACCESS is on, so the real function never reports "reached"
    // regardless of count — same proof-of-real-delegation as above.
    expect(await resolveHasReachedSubscriptionLimit("free", 999)).toBe(false);
  });
});
