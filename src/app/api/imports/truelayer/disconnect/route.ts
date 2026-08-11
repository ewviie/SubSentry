import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteBankConnection } from "@/lib/imports/bank-connections";
import { checkDisconnectRateLimit } from "@/lib/imports/rate-limit";

// Deletes every TrueLayer connection row this user has outright (not a soft
// "disabled" flag) — same reasoning as the Plaid/Gmail disconnect routes:
// the encrypted token stops existing in this app's database at all, not
// just stops being used. Plural, not singular — see bank-connections.ts's
// own comment on why a user can have more than one row per provider.
//
// Unlike Plaid (item/remove) and Google (RFC 7009's /revoke), TrueLayer
// does not publish a token-revocation API this app can call server-side —
// there is no documented endpoint to invoke here. That's a real, narrower
// version of the gap gmail/disconnect used to have before its own revoke
// call was added: the token stays technically valid at TrueLayer's end
// until it expires (~90 minutes for the access token; the refresh token
// longer) or the user separately revokes access from their bank's own
// online banking permissions screen. Noted rather than silently assumed
// away — add a revoke call here if TrueLayer ever documents one.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Its own limiter, not authorize's — see rate-limit.ts's comment on why
  // disconnect needs a separate (more generous) budget than a connect
  // attempt.
  const rateLimit = checkDisconnectRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a bit." },
      { status: 429 },
    );
  }

  await deleteBankConnection(session.user.id, "truelayer");
  return NextResponse.json({ ok: true });
}
