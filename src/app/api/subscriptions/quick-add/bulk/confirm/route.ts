import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { bulkQuickAddConfirmSchema } from "@/lib/subscriptions/validation";
import { checkBulkQuickAddConfirmRateLimit } from "@/lib/subscriptions/rate-limit";
import { createSubscriptionsBulkWithLimitCheck } from "@/lib/subscriptions/queries";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, MAX_ACTIVE_SUBSCRIPTIONS } from "@/lib/billing/plan";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// Step 2 of bulk quick-add: commits whatever the user kept/edited on the
// review screen. Mirrors /api/imports/confirm's own shape (same
// createSubscriptionsBulkWithLimitCheck call, same ceiling/plan-limit
// response bodies) minus the imports-table audit record — this isn't the
// Import Center (imports.source has no "ai_parsed"/"manual" value to write
// here, and bulk quick-add isn't the feature that table exists to audit;
// see schema.ts's own comment on that table). `source` is always
// "ai_parsed" here, hardcoded, never read from the request body — the same
// provenance tag a single quick-add confirm already sends to POST
// /api/subscriptions.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkBulkQuickAddConfirmRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many bulk-add confirmations recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bulkQuickAddConfirmSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { rows } = parsed.data;

  // Same per-user advisory-lock-protected, atomic check-then-insert as
  // /api/imports/confirm and a single POST /api/subscriptions — the
  // subscription limit (free-plan count, and the defensive
  // MAX_ACTIVE_SUBSCRIPTIONS ceiling) is enforced against the whole batch
  // in one transaction, not row by row, so a batch that would tip the
  // account over either bound is rejected as a whole rather than partially
  // applied.
  const bulkResult = await createSubscriptionsBulkWithLimitCheck(session.user.id, session.user.plan, rows, "ai_parsed");

  if (bulkResult.kind === "ceiling") {
    return NextResponse.json(
      {
        error: "subscription_limit_reached",
        message: `Adding these ${rows.length} subscriptions would exceed the maximum of ${MAX_ACTIVE_SUBSCRIPTIONS} subscriptions.`,
      },
      { status: 403 },
    );
  }
  if (bulkResult.kind === "plan") {
    return NextResponse.json(
      {
        error: "plan_limit_reached",
        message: `Adding these subscriptions would exceed the free plan limit of ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Upgrade to Pro for unlimited tracking.`,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({ subscriptions: bulkResult.subscriptions }, { status: 201 });
}
