import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isPlaidConfigured, getPlaidClient } from "@/lib/imports/plaid-client";
import { deleteBankConnection, decryptAccessToken } from "@/lib/imports/bank-connections";
import { checkDisconnectRateLimit } from "@/lib/imports/rate-limit";
import { logServerError } from "@/lib/observability/log-error";

// Same bound as gmail-client.ts's fetchWithTimeout — without this, Plaid's
// SDK (axios under the hood) has no default timeout configured anywhere
// (see plaid-client.ts's Configuration), so a slow/unresponsive Plaid API
// could otherwise hold this request open indefinitely. Passed as a per-call
// axios option to itemRemove below, not set on the shared client
// Configuration, since this route is the only caller that needs a hard
// ceiling on a best-effort, already-awaited call — the other Plaid routes
// (link-token, exchange, sync) are unaffected.
const ITEM_REMOVE_TIMEOUT_MS = 15_000;

// Deletes every Plaid connection row this user has outright (not a soft
// "disabled" flag) — same reasoning as gmail/disconnect: the local delete
// is the one guarantee this route makes, unconditionally, before the
// best-effort revoke-at-Plaid call below even starts. Plural, not singular:
// a user can have more than one Plaid connection (multi-institution
// linking — see bank-connections.ts's own comment), and "disconnect Plaid"
// means all of them.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Its own limiter, not authorize/exchange's — see rate-limit.ts's comment
  // on why disconnect needs a separate (more generous) budget than a
  // connect attempt.
  const rateLimit = checkDisconnectRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a bit." },
      { status: 429 },
    );
  }

  const deleted = await deleteBankConnection(session.user.id, "plaid");

  // Plaid's /item/remove invalidates the access token at Plaid's end and
  // unlinks the Item — best-effort, run only after the local delete above
  // has already succeeded, so this app's own ability to use the token is
  // gone regardless of what happens here. This call IS awaited before the
  // response below, though (not fire-and-forget) — ITEM_REMOVE_TIMEOUT_MS
  // is what keeps that bounded: without it, a slow/unresponsive Plaid API
  // could hold this request open indefinitely instead of just for up to
  // 15s, since neither Plaid's SDK nor this app's Configuration (see
  // plaid-client.ts) sets a default timeout on its own.
  if (isPlaidConfigured() && deleted.length > 0) {
    const client = getPlaidClient();
    await Promise.all(
      deleted.map(async (connection) => {
        try {
          await client.itemRemove(
            { access_token: decryptAccessToken(connection) },
            { timeout: ITEM_REMOVE_TIMEOUT_MS },
          );
        } catch (error) {
          logServerError("imports.plaid.disconnect.revoke", error, { userId: session.user.id });
        }
      }),
    );
  }

  return NextResponse.json({ ok: true });
}
