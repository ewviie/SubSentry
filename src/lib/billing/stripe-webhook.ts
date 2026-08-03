import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

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
