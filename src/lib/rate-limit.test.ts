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

describe("createRateLimiter.peek", () => {
  it("reports allowed for a key that has never been consumed, without creating a bucket for it", () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.peek("never-seen").allowed).toBe(true);
    // Confirmed by then actually consuming that same key and observing a
    // fresh full-limit bucket, not one peek() already spent — the whole
    // point of peek is that looking doesn't cost the caller anything.
    expect(limiter("never-seen").allowed).toBe(true);
    expect(limiter("never-seen").allowed).toBe(false);
  });

  it("does not consume a slot", () => {
    const limiter = createRateLimiter(1, 1000);
    limiter.peek("a");
    limiter.peek("a");
    limiter.peek("a");
    // Three peeks did not touch the one available slot — a real consuming
    // call right after still succeeds.
    expect(limiter("a").allowed).toBe(true);
  });

  it("reflects exhaustion once the real limit has actually been consumed", () => {
    const limiter = createRateLimiter(1, 1000);
    limiter("a");
    expect(limiter.peek("a").allowed).toBe(false);
  });

  it("reflects the window resetting, the same as the consuming check", async () => {
    const limiter = createRateLimiter(1, 10);
    limiter("a");
    expect(limiter.peek("a").allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(limiter.peek("a").allowed).toBe(true);
  });
});
