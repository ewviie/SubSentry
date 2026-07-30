import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkoutSessions, stripeEvents, users } from "@/lib/db/schema";
import { verifyStripeSignature, stripeCheckoutEventSchema } from "@/lib/billing/stripe-webhook";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const parsed = stripeCheckoutEventSchema.safeParse(JSON.parse(rawBody));
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
    }
  });

  return NextResponse.json({ received: true });
}
