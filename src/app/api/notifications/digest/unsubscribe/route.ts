import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyDigestUnsubscribeToken } from "@/lib/subscriptions/weekly-digest-job";
import { setWeeklyDigestEnabled } from "@/lib/auth/queries";

// No login required, by design — mirrors api/renewal-reminders/unsubscribe's
// own reasoning verbatim (see that route's comment): weeklyDigestEnabled now
// defaults to true for new signups (schema.ts), so this default-on email
// needs the same one-click, no-session-required floor. Authorization is the
// HMAC token itself (verifyDigestUnsubscribeToken), not a session; the only
// thing a valid token can ever do is set one boolean to false.
const querySchema = z.object({
  u: z.string().uuid(),
  t: z.string().min(1),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    u: url.searchParams.get("u") ?? undefined,
    t: url.searchParams.get("t") ?? undefined,
  });

  if (!parsed.success || !verifyDigestUnsubscribeToken(parsed.data.u, parsed.data.t)) {
    return NextResponse.redirect(new URL("/unsubscribed?ok=0&kind=digest", url));
  }

  await setWeeklyDigestEnabled(parsed.data.u, false);
  return NextResponse.redirect(new URL("/unsubscribed?ok=1&kind=digest", url));
}
