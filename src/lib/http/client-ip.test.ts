import { describe, it, expect } from "vitest";
import { getClientIp } from "./client-ip";

function requestWithXff(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("x-forwarded-for", value);
  return new Request("http://localhost/api/test", { method: "POST", headers });
}

describe("getClientIp", () => {
  it("returns the only value when there is a single hop", () => {
    expect(getClientIp(requestWithXff("203.0.113.5"))).toBe("203.0.113.5");
  });

  it("returns the last hop, not the first, for a multi-hop chain", () => {
    // Shape a real reverse proxy produces: whatever the client sent,
    // followed by the proxy's own observed address appended last.
    expect(getClientIp(requestWithXff("198.51.100.9, 10.0.0.1"))).toBe("10.0.0.1");
  });

  // The exact bypass reproduced live against /api/auth/signup before this
  // fix: a client prepending fake entries in front of whatever a trusted
  // proxy appends must not change which hop this function trusts.
  it("ignores attacker-prepended entries ahead of the trusted last hop", () => {
    const spoofed = requestWithXff("1.1.1.1, 2.2.2.2, 3.3.3.3, 10.0.0.1");
    expect(getClientIp(spoofed)).toBe("10.0.0.1");
  });

  it("trims whitespace around hops", () => {
    expect(getClientIp(requestWithXff("198.51.100.9 ,  10.0.0.1  "))).toBe("10.0.0.1");
  });

  it("falls back to 'unknown' when the header is absent", () => {
    expect(getClientIp(requestWithXff(null))).toBe("unknown");
  });

  it("falls back to 'unknown' when the header is empty/blank", () => {
    expect(getClientIp(requestWithXff("   "))).toBe("unknown");
  });
});
