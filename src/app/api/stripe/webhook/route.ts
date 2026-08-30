import { NextResponse } from "next/server";
import { verifyStripeSignature, stripeEventSchema, processStripeEvent } from "@/lib/billing/stripe-webhook";
import { readTextBody } from "@/lib/http/request-size";

// Real Stripe event payloads are a few KB; this endpoint is public and only
// signature-gated (not authenticated), so an oversized body is rejected
// before request.text() buffers it.
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const bodyResult = await readTextBody(request, MAX_WEBHOOK_BODY_BYTES);
  if (bodyResult.tooLarge) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const rawBody = bodyResult.data ?? "";
  const signature = request.headers.get("stripe-signature");

  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Signature verification above already proved this came from Stripe, so
    // malformed JSON here is a genuine anomaly (not a spoofed request) —
    // worth a 4xx that triggers Stripe's retry, unlike the 200 below for a
    // validly-shaped event this endpoint just doesn't act on.
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = stripeEventSchema.safeParse(body);
  if (!parsed.success) {
    // Not a shape this endpoint cares about (e.g. an event type we don't
    // act on) — acknowledge so Stripe doesn't retry indefinitely.
    return NextResponse.json({ received: true });
  }

  // Idempotency, plan-flip/downgrade, and every other DB side-effect live
  // in processStripeEvent (lib/billing/stripe-webhook.ts) — a plain,
  // DB-integration-tested function, not inlined here, so this route stays a
  // thin HTTP adapter: verify, parse, delegate, acknowledge.
  await processStripeEvent(parsed.data);

  return NextResponse.json({ received: true });
}
