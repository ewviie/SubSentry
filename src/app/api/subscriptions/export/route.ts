import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { subscriptionsToCsv } from "@/lib/subscriptions/export";

// A plain, Free-tier data-export — every plan's own data, in full, with no
// gating: this is portability/backup, not a Premium feature, the same
// principle CSV import already follows for getting data in. No rate limit
// needed either: this is one bounded read of the caller's own rows (capped
// at MAX_ACTIVE_SUBSCRIPTIONS regardless of plan — see lib/billing/plan.ts),
// not an AI call or anything else with a real per-request cost.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const subscriptions = await listSubscriptions(session.user.id);
  const csv = subscriptionsToCsv(subscriptions);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subsentry-subscriptions-${date}.csv"`,
    },
  });
}
