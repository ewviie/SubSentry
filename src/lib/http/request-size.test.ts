import { describe, it, expect } from "vitest";
import { isContentLengthWithinLimit, capRequestBody, readJsonBody, readTextBody, MAX_JSON_BODY_BYTES } from "./request-size";

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

// Builds a request whose body arrives as a stream with NO Content-Length
// header at all — the same shape a chunked-transfer-encoded request has by
// the time it reaches application code (undici strips/never sets
// Content-Length for a streamed body). This is what the live PoC against
// /api/auth/login used before the fix: a body larger than the declared
// limit, arriving with nothing in the headers for isContentLengthWithinLimit
// to reject.
//
// Pull-based (a chunk is only produced when the consumer actually asks for
// one via pull()), not built by enqueueing the whole body upfront in
// start() — the eager version could only ever prove the *end result*
// (rejected + exceeded() true), never that capRequestBody's consumer
// actually stopped reading early once the cap was crossed, since every byte
// would already be sitting in the stream's internal queue regardless of
// what capRequestBody did. producedBytes() reports how much the source
// actually emitted by the time reading stopped, so a test can assert that
// directly instead of inferring it.
function chunkedRequest(body: string, chunkSize = 1024): { request: Request; producedBytes: () => number } {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + chunkSize);
      offset += chunk.length;
      produced += chunk.length;
      controller.enqueue(chunk);
    },
  });
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, producedBytes: () => produced };
}

describe("capRequestBody", () => {
  it("has no Content-Length header — reproduces the chunked-encoding bypass shape", () => {
    expect(chunkedRequest("hello").request.headers.get("content-length")).toBeNull();
  });

  it("passes a body under the limit through unchanged", async () => {
    const { request: source } = chunkedRequest('{"a":1}');
    const { request, exceeded } = capRequestBody(source, 1024);
    const text = await request.text();
    expect(text).toBe('{"a":1}');
    expect(exceeded()).toBe(false);
  });

  it("cuts off and flags a body over the limit, regardless of missing Content-Length", async () => {
    const bigBody = "x".repeat(2000);
    const { request: source } = chunkedRequest(bigBody);
    const { request, exceeded } = capRequestBody(source, 100);
    await expect(request.text()).rejects.toThrow();
    expect(exceeded()).toBe(true);
  });

  it("never buffers past the cap even for a body far larger than it", async () => {
    // 2MB body against a 1MB-equivalent cap — the same magnitude as the
    // live repro (2MB chunked body against MAX_JSON_BODY_BYTES = 1MB).
    const twoMb = "y".repeat(2 * 1024 * 1024);
    const { request: source } = chunkedRequest(twoMb);
    const { request, exceeded } = capRequestBody(source, MAX_JSON_BODY_BYTES);
    await expect(request.text()).rejects.toThrow();
    expect(exceeded()).toBe(true);
  });

  // The actual regression this suite exists for: not just "the final
  // outcome is 'rejected'", but "the source stopped being asked for more
  // data once the cap was crossed" — i.e. reading genuinely stops early,
  // rather than the whole oversized body being pulled through and only
  // rejected at the very end.
  it("stops pulling from the source once the cap is exceeded, rather than consuming the whole body", async () => {
    const chunkSize = 1024;
    const maxBytes = 10 * chunkSize; // 10KB cap
    const farLarger = "y".repeat(1000 * chunkSize); // ~1000KB body, 100x the cap
    const { request: source, producedBytes } = chunkedRequest(farLarger, chunkSize);
    const { request, exceeded } = capRequestBody(source, maxBytes);

    await expect(request.text()).rejects.toThrow();
    expect(exceeded()).toBe(true);

    // Only a handful of chunks past the cap should ever have been pulled —
    // nowhere close to the full body. A generous multiple of the cap (not
    // an exact chunk count) keeps this robust to the pipe's own internal
    // buffering/backpressure margin without weakening what it proves: the
    // source was cut off, not drained.
    expect(producedBytes()).toBeLessThan(maxBytes * 4);
    expect(producedBytes()).toBeLessThan(farLarger.length);
  });
});

describe("readJsonBody", () => {
  it("parses a well-formed, under-limit JSON body", async () => {
    const { request } = chunkedRequest('{"email":"a@example.com"}');
    const result = await readJsonBody(request, MAX_JSON_BODY_BYTES);
    expect(result.tooLarge).toBe(false);
    expect(result.data).toEqual({ email: "a@example.com" });
  });

  it("flags tooLarge for a chunked body with no Content-Length that exceeds the cap", async () => {
    // The exact live repro: a JSON body bigger than MAX_JSON_BODY_BYTES,
    // arriving with no Content-Length header — previously accepted and
    // fully parsed (login/route.ts returned a normal 401, not a 413).
    const oversized = JSON.stringify({ email: `${"a".repeat(2 * 1024 * 1024)}@example.com`, password: "x" });
    const { request } = chunkedRequest(oversized);
    const result = await readJsonBody(request, MAX_JSON_BODY_BYTES);
    expect(result.tooLarge).toBe(true);
    expect(result.data).toBeNull();
  });

  it("still rejects a request that honestly declares an oversized Content-Length (fast path)", async () => {
    const result = await readJsonBody(requestWithLength(String(MAX_JSON_BODY_BYTES + 1)), MAX_JSON_BODY_BYTES);
    expect(result.tooLarge).toBe(true);
  });

  it("returns tooLarge: false with null data for genuinely malformed (but small) JSON", async () => {
    const { request } = chunkedRequest("{not valid json");
    const result = await readJsonBody(request, MAX_JSON_BODY_BYTES);
    expect(result.tooLarge).toBe(false);
    expect(result.data).toBeNull();
  });
});

describe("readTextBody", () => {
  it("returns raw text under the limit", async () => {
    const { request } = chunkedRequest("raw-body-text");
    const result = await readTextBody(request, MAX_JSON_BODY_BYTES);
    expect(result.tooLarge).toBe(false);
    expect(result.data).toBe("raw-body-text");
  });

  it("flags tooLarge for an oversized chunked body", async () => {
    const { request } = chunkedRequest("z".repeat(2 * 1024 * 1024));
    const result = await readTextBody(request, MAX_JSON_BODY_BYTES);
    expect(result.tooLarge).toBe(true);
    expect(result.data).toBeNull();
  });
});
