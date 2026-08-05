import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { importConfirmSchema } from "@/lib/imports/validation";
import { checkImportConfirmRateLimit } from "@/lib/imports/rate-limit";
import { createImportRecord } from "@/lib/imports/queries";
import { createSubscriptionsBulkWithLimitCheck } from "@/lib/subscriptions/queries";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, MAX_ACTIVE_SUBSCRIPTIONS } from "@/lib/billing/plan";
import { logServerError } from "@/lib/observability/log-error";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkImportConfirmRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many imports confirmed recently. Try again in a bit." },
      { status: 429 },
    );
  }

  // Every row is re-validated through the exact same subscriptionInputSchema
  // the manual form and quick-add both use (importConfirmSchema wraps it) —
  // nothing from /api/imports/analyze's response is trusted here, since the
  // client-side Edit step may have mutated any field. `source` is restricted
  // to the three import values by this schema, so a client can't smuggle
  // "manual" or "ai_parsed" through this endpoint.
  const parsed = importConfirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { source, rows, ignoredCount } = parsed.data;

  try {
    // Same plan-limit checks as /api/subscriptions POST, against the batch
    // total, and the same per-user advisory-lock protection against a
    // concurrent-request race (a double-submitted import, or a batch import
    // racing a manual add) — see createSubscriptionsBulkWithLimitCheck's own
    // comment in lib/subscriptions/queries.ts for the full reasoning.
    const bulkResult = await createSubscriptionsBulkWithLimitCheck(session.user.id, session.user.plan, rows, source);

    if (bulkResult.kind === "ceiling") {
      return NextResponse.json(
        {
          error: "subscription_limit_reached",
          message: `Importing these ${rows.length} subscriptions would exceed the maximum of ${MAX_ACTIVE_SUBSCRIPTIONS} subscriptions.`,
        },
        { status: 403 },
      );
    }
    if (bulkResult.kind === "plan") {
      return NextResponse.json(
        {
          error: "plan_limit_reached",
          message: `Importing these subscriptions would exceed the free plan limit of ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Upgrade to Pro for unlimited tracking.`,
        },
        { status: 403 },
      );
    }

    const importRecord = await createImportRecord({
      userId: session.user.id,
      source,
      status: "completed",
      detectedCount: rows.length + ignoredCount,
      importedCount: bulkResult.subscriptions.length,
      ignoredCount,
      errors: [],
    });

    return NextResponse.json({ subscriptions: bulkResult.subscriptions, importId: importRecord.id }, { status: 201 });
  } catch (error) {
    logServerError("imports.confirm", error, { userId: session.user.id, source });
    await createImportRecord({
      userId: session.user.id,
      source,
      status: "failed",
      detectedCount: rows.length + ignoredCount,
      importedCount: 0,
      ignoredCount,
      errors: [{ message: "Import failed while saving subscriptions." }],
    });
    return NextResponse.json(
      { error: "import_failed", message: "Couldn't save these subscriptions. Try again." },
      { status: 500 },
    );
  }
}
