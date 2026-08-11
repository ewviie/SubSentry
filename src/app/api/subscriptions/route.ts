import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { subscriptionInputSchema } from "@/lib/subscriptions/validation";
import { createSubscriptionWithLimitCheck, listSubscriptions } from "@/lib/subscriptions/queries";
import { checkSubscriptionCreateRateLimit } from "@/lib/subscriptions/rate-limit";
import { SUBSCRIPTION_SOURCES } from "@/lib/subscriptions/source";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, MAX_ACTIVE_SUBSCRIPTIONS } from "@/lib/billing/plan";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

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

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = createSubscriptionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { source, ...input } = parsed.data;

  // createSubscriptionWithLimitCheck runs the count-check and the insert
  // inside one transaction holding a per-user advisory lock — see its own
  // comment in lib/subscriptions/queries.ts for why: without it, two
  // concurrent POSTs from the same account could each read "under the
  // limit" before either's insert committed, letting one account exceed
  // MAX_ACTIVE_SUBSCRIPTIONS (or, once BETA_ALL_ACCESS is off, the
  // free-plan cap) by racing requests.
  const result = await createSubscriptionWithLimitCheck(session.user.id, session.user.plan, input, source ?? "manual");

  if (result.kind === "ceiling") {
    return NextResponse.json(
      {
        error: "subscription_limit_reached",
        message: `You've reached the maximum of ${MAX_ACTIVE_SUBSCRIPTIONS} subscriptions.`,
      },
      { status: 403 },
    );
  }
  if (result.kind === "plan") {
    return NextResponse.json(
      {
        error: "plan_limit_reached",
        message: `You've reached the free plan limit of ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Upgrade to Pro for unlimited tracking.`,
      },
      { status: 403 },
    );
  }
  return NextResponse.json({ subscription: result.subscription }, { status: 201 });
}
