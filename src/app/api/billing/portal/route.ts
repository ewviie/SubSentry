import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkBillingPortalRateLimit } from "@/lib/billing/rate-limit";
import { logServerError } from "@/lib/observability/log-error";

// Mints a one-time Stripe Billing Portal session URL for the signed-in
// user's stored customer id. No Stripe SDK dependency, same as the rest of
// this codebase's Stripe integration (see lib/billing/stripe-webhook.ts) —
// this is the one plain REST call the Portal API requires.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkBillingPortalRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const customerId = session.user.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { error: "no_billing_account", message: "No billing account on file yet. Try again after your upgrade finishes processing." },
      { status: 400 },
    );
  }

  const returnUrl = new URL("/settings", request.url).toString();

  let response: Response;
  try {
    response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ customer: customerId, return_url: returnUrl }),
      // Without this, a Stripe-side hang would hold the request (and the
      // user on a stuck "Opening billing portal…" button) indefinitely —
      // AbortSignal.timeout turns that into the same handled failure path
      // as a network error below, instead of an unbounded wait.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // A network-level failure (Stripe unreachable, DNS, timeout) throws
    // instead of resolving — without this catch it would 500 with no
    // server-side record at all, unlike every other genuine-failure path
    // in this codebase (see logServerError's call sites elsewhere).
    logServerError("billing.portal.fetch", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "stripe_error", message: "Couldn't open the billing portal. Try again in a moment." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    logServerError("billing.portal.non_ok", new Error(`Stripe billing portal request failed: ${response.status}`), {
      userId: session.user.id,
      status: response.status,
    });
    return NextResponse.json(
      { error: "stripe_error", message: "Couldn't open the billing portal. Try again in a moment." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    logServerError("billing.portal.no_url", new Error("Stripe billing portal response had no url"), {
      userId: session.user.id,
    });
    return NextResponse.json(
      { error: "stripe_error", message: "Couldn't open the billing portal. Try again in a moment." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: data.url });
}
