import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUnsubscribeToken } from "@/lib/subscriptions/renewal-reminders";
import { setRenewalRemindersEnabled } from "@/lib/auth/queries";

// No login required, by design — this is the one-click unsubscribe link
// every renewal reminder email carries (see renewal-reminders.ts's own
// comment: "obvious/easy way to disable", "never make unsubscribing
// intentionally difficult"). Authorization here is the HMAC token itself
// (verifyUnsubscribeToken), not a session; `u` identifies whose preference
// to flip, `t` proves the link was actually issued by this app for that
// user, not guessed or tampered with. The only thing a valid token can ever
// do is set one boolean to false — there's no path from this endpoint to
// reading or changing anything else about the account.
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

  if (!parsed.success || !verifyUnsubscribeToken(parsed.data.u, parsed.data.t)) {
    return NextResponse.redirect(new URL("/unsubscribed?ok=0", url));
  }

  await setRenewalRemindersEnabled(parsed.data.u, false);
  return NextResponse.redirect(new URL("/unsubscribed?ok=1", url));
}
