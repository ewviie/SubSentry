// `request.json()`/`request.formData()` fully buffer the body into memory
// before any application code (including a provider's own maxFileSizeBytes
// check — see api/imports/analyze/route.ts) gets to look at it. A
// Content-Length precheck rejects an oversized request before that buffering
// happens, rather than after — but it is exactly that, a precheck, not the
// authoritative defense: a client can omit Content-Length entirely (chunked
// transfer-encoding) or send a value that understates the real body, and
// this function has nothing to compare against. Verified live before
// capRequestBody below existed: a 2MB chunked-encoded body with no
// Content-Length header sailed straight past this check into full
// `request.json()` buffering on an unauthenticated route. Kept as a cheap
// fast-reject for the common case of an honest, well-behaved oversized
// request — capRequestBody is what actually enforces the limit against real
// bytes received, regardless of what any header claims.
export function isContentLengthWithinLimit(request: Request, maxBytes: number): boolean {
  const header = request.headers.get("content-length");
  if (!header) return true;
  const length = Number(header);
  if (!Number.isFinite(length)) return true;
  return length <= maxBytes;
}

// Generous ceiling for JSON API bodies in this app — the largest legitimate
// payload is /api/imports/confirm's up to-200-row array, still well under
// this. Distinct from a provider's own maxFileSizeBytes (multipart upload
// path), which stays the authority for file uploads.
export const MAX_JSON_BODY_BYTES = 1024 * 1024; // 1 MB

// The actual, header-independent enforcement: wraps the request body's own
// ReadableStream in a counting pass-through that errors out the moment more
// than maxBytes has flowed through it, then hands back a new Request built
// on that capped stream. Whatever later reads the body — .json(), .text(),
// .formData() — sees a stream that simply dies with an error once the cap
// is exceeded, however the client shaped the request (honest Content-Length,
// lied-about Content-Length, or no Content-Length at all via chunked
// transfer-encoding). Never buffers more than ~maxBytes plus one in-flight
// chunk, so an oversized request is capped in memory, not just rejected
// after the fact.
//
// `exceeded()` is a separate accessor rather than a typed error thrown
// across the stream boundary: a TransformStream's controller.error() value
// doesn't reliably survive `instanceof` checks once it's re-surfaced through
// a consuming .json()/.formData() call in every runtime this app targets,
// so callers check this flag after catching *any* rejection instead of
// trying to distinguish "too large" from "malformed" by error identity.
//
// `duplex: "half"` is required by the Fetch spec whenever a Request is
// constructed with a streaming (ReadableStream) body — Node's undici-based
// fetch/Request enforces this. It has no dedicated field in the DOM lib's
// RequestInit type, hence the cast.
export function capRequestBody(request: Request, maxBytes: number): { request: Request; exceeded: () => boolean } {
  if (!request.body) return { request, exceeded: () => false };

  let total = 0;
  let didExceed = false;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        didExceed = true;
        controller.error(new Error("request_body_too_large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  // Errors on this pipe (including the one thrown above) surface to
  // whatever reads `limiter.readable` — nothing further to do with the
  // rejection here, just keep it from becoming an unhandled rejection.
  request.body.pipeTo(limiter.writable).catch(() => {});

  const capped = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: limiter.readable,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  return { request: capped, exceeded: () => didExceed };
}

export interface BodyReadResult<T> {
  data: T | null;
  tooLarge: boolean;
}

// Shared shape for the common "read JSON, enforce the cap, tell the caller
// which failure it was" flow every JSON-body route repeats. `data` is null
// for both a too-large body and genuinely malformed JSON — callers already
// distinguish those cases via `tooLarge`, matching how every route already
// branches on isContentLengthWithinLimit today (just now backed by a real
// enforcement instead of a spoofable header check).
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyReadResult<unknown>> {
  if (!isContentLengthWithinLimit(request, maxBytes)) {
    return { data: null, tooLarge: true };
  }
  const { request: capped, exceeded } = capRequestBody(request, maxBytes);
  const data = await capped.json().catch(() => null);
  if (data === null && exceeded()) {
    return { data: null, tooLarge: true };
  }
  return { data, tooLarge: false };
}

// Same shape as readJsonBody, for the one route (Stripe webhook) that reads
// raw text instead of JSON — it needs the raw body for signature
// verification before ever parsing it.
export async function readTextBody(request: Request, maxBytes: number): Promise<BodyReadResult<string>> {
  if (!isContentLengthWithinLimit(request, maxBytes)) {
    return { data: null, tooLarge: true };
  }
  const { request: capped, exceeded } = capRequestBody(request, maxBytes);
  const text = await capped.text().catch(() => null);
  if (text === null && exceeded()) {
    return { data: null, tooLarge: true };
  }
  return { data: text, tooLarge: false };
}
