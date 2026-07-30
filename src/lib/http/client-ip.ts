// x-forwarded-for is caller-supplied and trivially spoofable by a direct
// client, but this app sits behind a reverse proxy/platform load balancer
// in production which sets (and doesn't forward client-supplied copies of)
// this header — good enough for rate-limit bucketing, not for anything
// authorization-relevant.
export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
