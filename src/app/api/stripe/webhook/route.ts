import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkoutSessions, stripeEvents, users } from "@/lib/db/schema";
import { verifyStripeSignature, stripeEventSchema } from "@/lib/billing/stripe-webhook";
import { readTextBody } from "@/lib/http/request-size";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  const event = parsed.data;

  // Idempotency: Stripe retries delivery on anything but a fast 2xx, and can
  // redeliver the same event id. Recording it first and bailing on a
  // conflict means a retried delivery never runs activation logic twice.
  // Everything below runs in the same transaction as that insert — if the
  // checkoutSessions write fails partway through, the stripeEvents insert
  // rolls back with it, so a retried delivery reprocesses cleanly instead of
  // silently losing the checkout because the event id already "looks done".
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });

    if (inserted.length === 0) return;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const candidateUserId = session.client_reference_id ?? null;

      // client_reference_id is caller-supplied (it's just a URL query param
      // on the Payment Link), so confirm it resolves to a real user before
      // trusting it as the FK — checkoutSessions.userId cascades to null on
      // user deletion, but a garbage or stale id would otherwise fail the
      // insert outright.
      let userId: string | null = null;
      if (candidateUserId && UUID_RE.test(candidateUserId)) {
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, candidateUserId))
          .limit(1);
        userId = user?.id ?? null;
      }

      await tx
        .insert(checkoutSessions)
        .values({
          id: session.id,
          userId,
          email: session.customer_details?.email ?? null,
          status: "completed",
        })
        .onConflictDoNothing();

      // Stored now (ahead of /api/billing/activate redeeming this checkout)
      // so the Billing Portal route has a customer id to open a session
      // against as soon as activation runs — activation itself doesn't need
      // to touch this column.
      if (userId && session.customer) {
        await tx
          .update(users)
          .set({ stripeCustomerId: session.customer, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
    }

    // Fires once a subscription is actually terminated — either canceled
    // immediately or a scheduled cancel-at-period-end reaching its end date.
    // Matched by customer id, not subscription id: this app never stores a
    // Stripe subscription id (see schema.ts's stripeCustomerId comment), and
    // the Payment Link flow only ever creates one subscription per customer.
    if (event.type === "customer.subscription.deleted") {
      const customerId = event.data.object.customer;
      if (customerId) {
        await tx
          .update(users)
          .set({ plan: "free", updatedAt: new Date() })
          .where(eq(users.stripeCustomerId, customerId));
      }
    }
  });

  return NextResponse.json({ received: true });
}
