import { describe, it, expect } from "vitest";
import { isContentLengthWithinLimit, MAX_JSON_BODY_BYTES } from "./request-size";

function requestWithLength(length: string | null): Request {
  const headers = new Headers();
  if (length !== null) headers.set("content-length", length);
  return new Request("http://localhost/api/test", { method: "POST", headers });
}

describe("isContentLengthWithinLimit", () => {
  it("allows a request under the limit", () => {
    expect(isContentLengthWithinLimit(requestWithLength("1000"), MAX_JSON_BODY_BYTES)).toBe(true);
  });

  it("allows a request exactly at the limit", () => {
    expect(isContentLengthWithinLimit(requestWithLength(String(MAX_JSON_BODY_BYTES)), MAX_JSON_BODY_BYTES)).toBe(true);
  });

  it("rejects a request over the limit", () => {
    expect(isContentLengthWithinLimit(requestWithLength(String(MAX_JSON_BODY_BYTES + 1)), MAX_JSON_BODY_BYTES)).toBe(false);
  });

  it("rejects a large declared upload size", () => {
    expect(isContentLengthWithinLimit(requestWithLength(String(50 * 1024 * 1024)), MAX_JSON_BODY_BYTES)).toBe(false);
  });

  // A client can omit Content-Length or lie about it — this check is a fast
  // precheck, not the authoritative defense (per-field Zod limits and each
  // provider's own maxFileSizeBytes still apply after parsing).
  it("does not block a request with no Content-Length header (can't precheck what isn't declared)", () => {
    expect(isContentLengthWithinLimit(requestWithLength(null), MAX_JSON_BODY_BYTES)).toBe(true);
  });

  it("does not block a non-numeric Content-Length header", () => {
    expect(isContentLengthWithinLimit(requestWithLength("not-a-number"), MAX_JSON_BODY_BYTES)).toBe(true);
  });
});
