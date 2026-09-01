import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listNotifications, getUnreadNotificationCount } from "@/lib/notifications/queries";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";

// A plain read — no sync side effect here. Generating fresh notifications
// needs subscriptions + price history + savings recommendations already
// loaded (see generate.ts), which this route has no reason to fetch a
// second time on every bell-icon poll when the pages that already load that
// data (dashboard, /notifications) call syncNotifications themselves. This
// keeps the bell's own polling cheap: one indexed list query and one
// indexed count query, nothing more.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isPremium = await resolveHasPaidAccess(session.user.plan);
  const [notifications, unreadCount] = await Promise.all([
    listNotifications(session.user.id, { isPremium }),
    getUnreadNotificationCount(session.user.id),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
