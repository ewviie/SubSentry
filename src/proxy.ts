import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

const PROTECTED_PREFIXES = ["/dashboard", "/subscriptions", "/settings"];
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function buildCsp(nonce: string): string {
  // No custom inline scripts anywhere in this app — Next.js applies this
  // nonce to its own framework-injected scripts automatically once it sees
  // the nonce on both the request header (below) and this response header.
  // 'strict-dynamic' lets those nonced scripts load their own chunks
  // without every chunk needing its own nonce.
  // style-src keeps 'unsafe-inline': next/font emits inline @font-face
  // <style> tags per build that aren't nonce-able the same way, and inline
  // style injection is a materially lower-severity XSS vector than script.
  // 'unsafe-eval' is added in dev only — React's dev-mode debugging
  // (component stack reconstruction) calls eval() and is hard-blocked
  // without it; React itself guarantees it "will never use eval() in
  // production mode", so prod stays strict.
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Defense-in-depth beyond SameSite=Lax cookies: reject cross-origin
// state-changing requests that carry our session cookie. Scoped to
// requests that actually have the cookie (rather than all of /api/*) so
// this can never interfere with server-to-server calls that don't carry
// it — the Stripe webhook, in particular, is authenticated entirely by its
// HMAC signature and never sends this cookie, so it's naturally exempt
// without needing an explicit path exclusion.
//
// `request.nextUrl.origin` reflects the Host header Next.js sees on this
// request. Behind a reverse proxy that doesn't forward/preserve the
// original public Host (nginx, Caddy, Cloudflare, and Vercel all do this
// correctly by default), this comparison could mismatch on entirely
// legitimate same-origin traffic. If same-origin requests ever start
// getting 403'd in production, check the proxy's Host-forwarding config
// before suspecting this logic — this is the standard, accepted tradeoff of
// Origin-based CSRF checks (the same one Rails' and Django's built-in CSRF
// protection make), not unique to this implementation.
function isCrossOriginMutation(request: NextRequest): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method)) return false;
  if (!request.cookies.has(SESSION_COOKIE)) return false;

  const sourceOrigin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!sourceOrigin) return false; // nothing to compare — let SameSite carry the defense alone

  try {
    return new URL(sourceOrigin).origin !== request.nextUrl.origin;
  } catch {
    return true; // unparseable Origin/Referer is itself suspicious
  }
}

export function proxy(request: NextRequest) {
  if (isCrossOriginMutation(request)) {
    return NextResponse.json({ error: "cross_origin_forbidden" }, { status: 403 });
  }

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  // Cheap cookie-presence redirect only — no DB round trip here. The
  // authoritative check lives in requireUser() (lib/auth/session.ts), called
  // by every protected page/route.
  //
  // Deliberately does NOT redirect authenticated-looking users away from
  // /login or /signup here: a stale/expired cookie (DB reset, natural
  // expiry) is still "present" from middleware's point of view, which would
  // bounce the user straight back to /dashboard — which itself redirects to
  // /login via requireUser() once it discovers the session doesn't validate,
  // producing an infinite redirect loop with no way to reach the login form.
  // That authenticated-redirect is instead handled by the (auth) route
  // group's layout using the authoritative getSession() check, which can
  // tell "present but invalid" apart from "actually logged in".
  if (isProtected && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // btoa, not Buffer — middleware can run on the Edge runtime, which doesn't
  // provide Node's Buffer. A UUID is plain ASCII, so btoa (a standard Web
  // API, available on both Edge and Node) encodes it safely.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
