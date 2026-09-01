import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/notifications/queries";
import { checkNotificationMarkReadRateLimit } from "@/lib/notifications/rate-limit";

type Params = { params: Promise<{ id: string }> };

// notifications.id is a Postgres uuid column — same validate-before-query
// posture as api/subscriptions/[id]/route.ts's own parseId, for the same
// reason (a malformed id would otherwise throw a driver-level error instead
// of a clean 400).
const idSchema = z.string().uuid();

export async function POST(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkNotificationMarkReadRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests. Try again in a bit." },
      { status: 429 },
    );
  }

  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: "Invalid notification id." }, { status: 400 });
  }

  // markNotificationRead is scoped by userId on its own WHERE clause (see
  // queries.ts) — another user's notification id simply matches zero rows
  // here, never leaking whether it exists at all. `found: false` covers
  // both "doesn't exist" and "belongs to someone else" identically, on
  // purpose, same non-enumerating posture ownership-scoped routes elsewhere
  // in this app already follow.
  const found = await markNotificationRead(session.user.id, parsed.data);
  return NextResponse.json({ ok: found });
}
