import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkoutSessions, stripeEvents, users } from "@/lib/db/schema";

// No Stripe SDK dependency — this is the whole verification algorithm Stripe
// documents: https://docs.stripe.com/webhooks#verify-manually. Doing it by
// hand keeps the bundle light and mirrors how the rest of this codebase
// treats third-party auth (see lib/auth/session.ts's own HMAC-free but
// hash-based token design).
const TOLERANCE_SECONDS = 5 * 60;

export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  // Stripe sends multiple v1= entries during a signing-secret rotation (one
  // signed with the old secret, one with the new) — a Map here would keep
  // only the last one and could reject a genuinely valid signature. Collect
  // every v1 value and accept if any of them match.
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=");
    if (key === "t" && value) timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return signatures.some((signature) => {
    const actualBuffer = Buffer.from(signature, "hex");
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  });
}

// Only the fields this app actually reads from a Stripe event — deliberately
// not the full Stripe API type surface, since we don't depend on the SDK.
// One lenient object shape covers every event type this endpoint handles
// (checkout.session.completed and customer.subscription.deleted) rather than
// a schema per type, since Stripe's checkout Session and Subscription
// objects both carry a top-level `customer` id and this app never reads
// anything from either beyond the fields listed here.
export const stripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string(),
      client_reference_id: z.string().nullable().optional(),
      customer_details: z
        .object({ email: z.string().nullable().optional() })
        .nullable()
        .optional(),
      customer: z.string().nullable().optional(),
    }),
  }),
});

export type StripeEvent = z.infer<typeof stripeEventSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extracted out of api/stripe/webhook/route.ts (P1 production-readiness
// pass) so the actual DB side-effects of a verified Stripe event are a
// plain, testable function — the same "route.ts is a thin HTTP adapter,
// the real logic lives in lib/ and gets a real test" shape every other API
// route in this app already follows (see e.g. billing/activate's own
// ownership check, tested indirectly via its route, versus this one which
// is DB-integration-tested directly — see stripe-webhook.db.test.ts).
//
// P1 fix: previously, a successful `checkout.session.completed` only
// recorded the checkout (status "completed") and left the actual
// `users.plan = "pro"` flip to /api/billing/activate — which only ever
// runs if the user's browser completes the redirect Stripe sends them back
// to. A user who paid and then closed the tab, lost their session, or hit
// a network blip on that redirect would be charged by Stripe and never
// actually receive Premium access, with nothing to notice or correct it.
// The webhook is the reliable source of truth Stripe itself recommends
// building on (delivery is retried; a client-side redirect is not) — this
// now grants access the moment payment is confirmed, here, unconditionally,
// independent of whether the client-side activation flow ever runs at all.
// /api/billing/activate is unchanged and still runs on the normal path: its
// own plan update is now just as an idempotent no-op in the common case,
// its ownership check and prompt UI confirmation remain exactly as useful
// as before.
export async function processStripeEvent(event: StripeEvent): Promise<void> {
  await db.transaction(async (tx) => {
    // Idempotency: Stripe retries delivery on anything but a fast 2xx, and
    // can redeliver the same event id. Recording it first and bailing on a
    // conflict means a retried delivery never runs activation logic twice.
    // Everything below runs in the same transaction as that insert — if a
    // later write fails partway through, the stripeEvents insert rolls back
    // with it, so a retried delivery reprocesses cleanly instead of
    // silently losing the checkout because the event id already "looks
    // done".
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

      if (userId) {
        // Grant access here, now — see this function's own header comment
        // for why this can no longer wait on the client-side redirect.
        // checkoutSessions.status stays "completed" (not "activated"):
        // that field means "the activate endpoint has explicitly run,"
        // a distinct bookkeeping fact from "the user already has access,"
        // which users.plan is now the sole source of truth for. Idempotent
        // either way — an UPDATE to a user already on "pro" is a no-op.
        await tx.update(users).set({ plan: "pro", updatedAt: new Date() }).where(eq(users.id, userId));

        // Stored now (ahead of /api/billing/activate redeeming this
        // checkout) so the Billing Portal route has a customer id to open a
        // session against as soon as activation runs — activation itself
        // doesn't need to touch this column.
        if (session.customer) {
          await tx
            .update(users)
            .set({ stripeCustomerId: session.customer, updatedAt: new Date() })
            .where(eq(users.id, userId));
        }
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
        await tx.update(users).set({ plan: "free", updatedAt: new Date() }).where(eq(users.stripeCustomerId, customerId));
      }
    }
  });
}
