// x-forwarded-for is a comma-separated hop chain: "client, proxy1, proxy2,
// ..." where each hop APPENDS the address it saw to the end of whatever it
// received — it does not replace it. That means the *first* entry is
// whatever the original connecting client claimed (fully attacker-supplied
// if that client behaves like `curl -H`), while the *last* entry is the one
// this app's own trusted reverse proxy/platform edge appended after
// observing the real TCP connection.
//
// Security assumption this makes, spelled out (per project convention — see
// proxy.ts's isCrossOriginMutation for the same style of documented
// tradeoff): this app is deployed behind exactly one reverse proxy or
// platform edge (nginx, Caddy, Cloudflare, Vercel, Fly.io, Render, etc.)
// that appends the real client IP as the last hop and does not let a client
// inject extra trailing entries after its own. That's the standard behavior
// for all of the above. Taking the *first* entry (the previous
// implementation) trusted the one hop a direct client fully controls,
// which is what let a client bypass every IP-keyed rate limiter by sending
// a fresh X-Forwarded-For value on each request — verified by reproducing
// that bypass against /api/auth/signup before this fix (rotating spoofed
// header defeated the 5/hour limit entirely) and confirming the limiter
// enforces correctly once the last hop is trusted instead.
//
// Residual risk this does NOT close: an app exposed directly with no
// reverse proxy in front of it (nothing appending a real hop) still can't
// distinguish a spoofed lone value from a real one — there is no proxy-free
// way to recover the true client IP from the Fetch-API Request object Next.js
// route handlers receive (no raw socket access, unlike the old Pages Router
// req.socket.remoteAddress). IP-based limiting is defense-in-depth in that
// topology, not a hard guarantee; the non-IP-keyed backstops elsewhere
// (per-email login limiter, DB-backed lockout, CAPTCHA) are what carry the
// real weight there.
export function getClientIp(request: Request): string {
  const header = request.headers.get("x-forwarded-for");
  if (!header) return "unknown";
  const hops = header.split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : "unknown";
}
