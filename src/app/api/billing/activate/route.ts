import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { checkoutSessions, users } from "@/lib/db/schema";

const activateSchema = z.object({
  checkoutSessionId: z.string().trim().min(1),
});

// Redeems the Payment Link's redirect (`/dashboard?checkout_session_id=...`)
// once the webhook (api/stripe/webhook/route.ts) has recorded the completed
// checkout. Ownership is strictly the userId the webhook resolved from
// client_reference_id — deliberately no email fallback. This app doesn't
// verify email ownership at signup, so an email-based match would let anyone
// who learns a checkoutSessionId (referrer leak, shared link, support
// ticket) sign up with the payer's email and claim their entitlement first.
// A session with no resolved userId (client_reference_id missing/invalid)
// simply can't be self-service activated — a rare case that needs manual
// follow-up rather than a security hole.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = activateSchema.safeParse(await request.json().catch(() => null));
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
