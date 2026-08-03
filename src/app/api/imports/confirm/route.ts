import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { importConfirmSchema } from "@/lib/imports/validation";
import { checkImportConfirmRateLimit } from "@/lib/imports/rate-limit";
import { bulkCreateSubscriptionsFromImport, createImportRecord } from "@/lib/imports/queries";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import {
  FREE_PLAN_SUBSCRIPTION_LIMIT,
  MAX_ACTIVE_SUBSCRIPTIONS,
  hasReachedSubscriptionLimit,
} from "@/lib/billing/plan";

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

  // Same plan-limit checks as /api/subscriptions POST, but against the
  // batch total — checked up front, before inserting anything, so a batch
  // that would exceed the limit is rejected outright rather than partially
  // imported.
  const existing = await listSubscriptions(session.user.id);
  const activeCount = existing.filter((s) => s.status === "active").length;
  const activeRowCount = rows.filter((row) => row.status === "active").length;

  if (existing.length + rows.length > MAX_ACTIVE_SUBSCRIPTIONS) {
    return NextResponse.json(
      {
        error: "subscription_limit_reached",
        message: `Importing these ${rows.length} subscriptions would exceed the maximum of ${MAX_ACTIVE_SUBSCRIPTIONS} subscriptions.`,
      },
      { status: 403 },
    );
  }

  if (hasReachedSubscriptionLimit(session.user.plan, activeCount + activeRowCount)) {
    return NextResponse.json(
      {
        error: "plan_limit_reached",
        message: `Importing these subscriptions would exceed the free plan limit of ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Upgrade to Pro for unlimited tracking.`,
      },
      { status: 403 },
    );
  }

  try {
    const created = await bulkCreateSubscriptionsFromImport(session.user.id, rows, source);
    const importRecord = await createImportRecord({
      userId: session.user.id,
      source,
      status: "completed",
      detectedCount: rows.length + ignoredCount,
      importedCount: created.length,
      ignoredCount,
      errors: [],
    });

    return NextResponse.json({ subscriptions: created, importId: importRecord.id }, { status: 201 });
  } catch {
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
