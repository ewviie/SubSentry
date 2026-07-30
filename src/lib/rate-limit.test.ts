import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter("a").allowed).toBe(true);
    expect(limiter("a").allowed).toBe(true);
    expect(limiter("a").allowed).toBe(true);
  });

  it("blocks requests once the limit is reached", () => {
    const limiter = createRateLimiter(2, 1000);
    limiter("a");
    limiter("a");
    const result = limiter("a");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks separate keys independently", () => {
    const limiter = createRateLimiter(1, 1000);
    limiter("a");
    expect(limiter("a").allowed).toBe(false);
    expect(limiter("b").allowed).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const limiter = createRateLimiter(1, 10);
    limiter("a");
    expect(limiter("a").allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(limiter("a").allowed).toBe(true);
  });
});
