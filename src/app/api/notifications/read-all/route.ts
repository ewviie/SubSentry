import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/notifications/queries";
import { checkNotificationMarkReadRateLimit } from "@/lib/notifications/rate-limit";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkNotificationMarkReadRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests. Try again in a bit." },
      { status: 429 },
    );
  }

  await markAllNotificationsRead(session.user.id);
  return NextResponse.json({ ok: true });
}
