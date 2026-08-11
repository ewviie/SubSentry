import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { subscriptionIdSchema, subscriptionUpdateSchema } from "@/lib/subscriptions/validation";
import { deleteSubscription, getSubscription, updateSubscription } from "@/lib/subscriptions/queries";
import { checkSubscriptionMutateRateLimit } from "@/lib/subscriptions/rate-limit";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

type Params = { params: Promise<{ id: string }> };

const INVALID_ID = {
  error: "invalid_request",
  message: "Invalid subscription id.",
} as const;

// subscriptions.id is a Postgres uuid column — validated here, before any
// query, on every handler below. Without this, a malformed id (not shaped
// like a UUID at all) makes the driver throw "invalid input syntax for type
// uuid" instead of the query just matching zero rows, crashing the route
// with an unhandled 500 instead of a clean 400. See subscriptionIdSchema's
// own comment in lib/subscriptions/validation.ts.
function parseId(id: string): string | null {
  const parsed = subscriptionIdSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function GET(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const validId = parseId(id);
  if (!validId) return NextResponse.json(INVALID_ID, { status: 400 });

  const subscription = await getSubscription(session.user.id, validId);
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
  const validId = parseId(id);
  if (!validId) return NextResponse.json(INVALID_ID, { status: 400 });

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = subscriptionUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const subscription = await updateSubscription(session.user.id, validId, parsed.data);
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
  const validId = parseId(id);
  if (!validId) return NextResponse.json(INVALID_ID, { status: 400 });

  const ok = await deleteSubscription(session.user.id, validId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
