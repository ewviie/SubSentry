import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { subscriptionUpdateSchema } from "@/lib/subscriptions/validation";
import { deleteSubscription, getSubscription, updateSubscription } from "@/lib/subscriptions/queries";
import { checkSubscriptionMutateRateLimit } from "@/lib/subscriptions/rate-limit";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const subscription = await getSubscription(session.user.id, id);
  if (!subscription) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ subscription });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkSubscriptionMutateRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many changes recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const { id } = await params;
  const parsed = subscriptionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const subscription = await updateSubscription(session.user.id, id, parsed.data);
  if (!subscription) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ subscription });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkSubscriptionMutateRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many changes recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const { id } = await params;
  const ok = await deleteSubscription(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
