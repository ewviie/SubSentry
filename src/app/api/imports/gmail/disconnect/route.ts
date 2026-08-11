import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getEmailConnection, decryptAccessToken, decryptRefreshToken, deleteEmailConnection } from "@/lib/imports/email-connections";
import { revokeToken } from "@/lib/imports/gmail-client";
import { checkDisconnectRateLimit } from "@/lib/imports/rate-limit";
import { logServerError } from "@/lib/observability/log-error";

// Deletes the stored connection row outright (not a soft "disabled" flag) —
// the whole point of a disconnect action is that the encrypted token stops
// existing in this app's database at all, not just stops being used. That
// deletion is the one guarantee this route makes, unconditionally, and it
// always happens before the best-effort revoke-at-Google call below even
// starts — see revokeToken's own comment on why. That call IS awaited
// before this route responds (not fire-and-forget), so it does hold the
// response open — bounded to at most fetchWithTimeout's 15s (gmail-client.ts),
// not unconditionally fast; only its *failure* is non-load-bearing, not its
// latency.
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

  // Read before deleting — the row (and the only copy of its encrypted
  // token) won't exist to read from after.
  const connection = await getEmailConnection(session.user.id, "gmail");

  await deleteEmailConnection(session.user.id, "gmail");

  if (connection) {
    try {
      // Revoking either token invalidates the whole grant at Google's end
      // (RFC 7009) — prefer the refresh token when one exists since it's
      // the longer-lived credential; fall back to the access token
      // otherwise (e.g. a re-consent that never issued a fresh refresh
      // token — see schema.ts's comment on emailConnections).
      const refreshToken = decryptRefreshToken(connection);
      await revokeToken(refreshToken ?? decryptAccessToken(connection));
    } catch (error) {
      // Never surfaced to the caller as an error response — this app's own
      // ability to use the token is already gone (deleted above); a failure
      // here only means the token lingers, still valid, at Google's end
      // until it naturally expires or the user revokes it themselves from
      // myaccount.google.com/permissions, exactly the pre-existing behavior
      // before this call was added.
      logServerError("imports.gmail.disconnect.revoke", error, { userId: session.user.id });
    }
  }

  return NextResponse.json({ ok: true });
}
