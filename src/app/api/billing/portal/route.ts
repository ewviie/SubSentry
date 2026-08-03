import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkBillingPortalRateLimit } from "@/lib/billing/rate-limit";

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

  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ customer: customerId, return_url: returnUrl }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "stripe_error", message: "Couldn't open the billing portal. Try again in a moment." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    return NextResponse.json(
      { error: "stripe_error", message: "Couldn't open the billing portal. Try again in a moment." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: data.url });
}
