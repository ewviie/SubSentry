import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { subscriptionInputSchema } from "@/lib/subscriptions/validation";
import { createSubscription, listSubscriptions } from "@/lib/subscriptions/queries";
import { checkSubscriptionCreateRateLimit } from "@/lib/subscriptions/rate-limit";
import { SUBSCRIPTION_SOURCES } from "@/lib/subscriptions/source";
import {
  FREE_PLAN_SUBSCRIPTION_LIMIT,
  MAX_ACTIVE_SUBSCRIPTIONS,
  hasReachedSubscriptionLimit,
} from "@/lib/billing/plan";

// `source` is provenance metadata only (drives the "AI-parsed"/"Imported"
// badge in the UI) — it has no effect on validation or authorization, so
// trusting the client's hint here is fine. The import-specific values
// (csv_import/apple_import/google_play_import) are included here too since
// nothing prevents a client from creating a single subscription through this
// endpoint with an import-sourced provenance tag; the Import Center's own
// bulk-confirm flow goes through /api/imports/confirm instead, which
// restricts `source` to only those three values.
const createSubscriptionSchema = subscriptionInputSchema.extend({
  source: z.enum(SUBSCRIPTION_SOURCES).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const subscriptions = await listSubscriptions(session.user.id);
  return NextResponse.json({ subscriptions });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Bounds how fast one account can create rows regardless of status — the
  // ceiling check below only bounds the total, not the rate of getting there.
  const rateLimit = checkSubscriptionCreateRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many subscriptions added recently. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const parsed = createSubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // The free-plan check only applies to free users and only counts "active"
  // rows, matching the same definition getDashboardData() uses elsewhere — a
  // canceled/paused subscription shouldn't count against it any more than it
  // counts toward spend totals. The defensive ceiling below is different: it
  // must count every row regardless of status, since a paused/canceled
  // subscription still occupies a row and costs the same to store and query
  // — counting only "active" rows here would let an account grow this table
  // without bound just by creating rows with status=canceled.
  const existing = await listSubscriptions(session.user.id);
  const activeCount = existing.filter((s) => s.status === "active").length;

  if (existing.length >= MAX_ACTIVE_SUBSCRIPTIONS) {
    return NextResponse.json(
      {
        error: "subscription_limit_reached",
        message: `You've reached the maximum of ${MAX_ACTIVE_SUBSCRIPTIONS} subscriptions.`,
      },
      { status: 403 },
    );
  }

  if (hasReachedSubscriptionLimit(session.user.plan, activeCount)) {
    return NextResponse.json(
      {
        error: "plan_limit_reached",
        message: `You've reached the free plan limit of ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Upgrade to Pro for unlimited tracking.`,
      },
      { status: 403 },
    );
  }

  const { source, ...input } = parsed.data;
  const subscription = await createSubscription(session.user.id, input, source);
  return NextResponse.json({ subscription }, { status: 201 });
}
