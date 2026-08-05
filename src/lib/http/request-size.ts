// `request.json()`/`request.formData()` fully buffer the body into memory
// before any application code (including a provider's own maxFileSizeBytes
// check — see api/imports/analyze/route.ts) gets to look at it. A
// Content-Length precheck rejects an oversized request before that buffering
// happens, rather than after. Not a substitute for a platform/proxy-level
// body limit (a client can omit or lie about Content-Length, in which case
// this simply doesn't fire and the later, still-authoritative per-field
// Zod/file-size checks are what actually protect the server) — this closes
// the common case where a well-behaved-looking client sends an honest
// oversized request, cheaply, before any parsing work happens.
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
