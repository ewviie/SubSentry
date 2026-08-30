import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { checkoutSessions, users } from "@/lib/db/schema";
import { checkActivateRateLimit } from "@/lib/billing/rate-limit";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

const activateSchema = z.object({
  checkoutSessionId: z.string().trim().min(1),
});

// Redeems the Payment Link's redirect (`/dashboard?checkout_session_id=...`)
// once the webhook (lib/billing/stripe-webhook.ts's processStripeEvent) has
// recorded the completed checkout. P1 note: the webhook is now the actual
// source of truth for granting access — it flips users.plan to "pro" itself
// the moment Stripe confirms payment, independent of whether this endpoint
// ever runs at all (a user who closes the tab mid-redirect still ends up
// Premium). This endpoint's own plan update below is consequently an
// idempotent no-op in the common case; what it still uniquely provides is
// the ownership check (below) and a fast, explicit confirmation the client
// can wait on rather than polling for the webhook to land. Ownership is
// strictly the userId the webhook resolved from client_reference_id —
// deliberately no email fallback. This app doesn't verify email ownership
// at signup, so an email-based match would let anyone who learns a
// checkoutSessionId (referrer leak, shared link, support ticket) sign up
// with the payer's email and claim their entitlement first. A session with
// no resolved userId (client_reference_id missing/invalid) simply can't be
// self-service activated — a rare case that needs manual follow-up rather
// than a security hole.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkActivateRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a bit." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = activateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Invalid input." }, { status: 400 });
  }

  const [checkout] = await db
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, parsed.data.checkoutSessionId))
    .limit(1);

  if (!checkout) {
    // The webhook may not have landed yet — this isn't necessarily wrong,
    // just early. The client can retry shortly.
    return NextResponse.json(
      { error: "not_found", message: "Still processing your upgrade. Try again in a moment." },
      { status: 404 },
    );
  }

  // Ownership must be checked before the already-activated shortcut below —
  // otherwise any authenticated user supplying someone else's redeemed
  // checkoutSessionId gets back a false {plan:"pro"} success response.
  if (checkout.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (checkout.status === "activated") {
    return NextResponse.json({ plan: "pro" });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ plan: "pro", updatedAt: new Date() })
      .where(eq(users.id, session.user.id));

    await tx
      .update(checkoutSessions)
      .set({ status: "activated", activatedAt: new Date() })
      .where(eq(checkoutSessions.id, checkout.id));
  });

  return NextResponse.json({ plan: "pro" });
}
