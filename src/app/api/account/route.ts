import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSession, destroySession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { checkDeleteAccountRateLimit } from "@/lib/auth/rate-limit";
import { deleteUserAndAllData } from "@/lib/auth/account-deletion";
import {
  getEmailConnection,
  decryptAccessToken as decryptEmailAccessToken,
  decryptRefreshToken as decryptEmailRefreshToken,
} from "@/lib/imports/email-connections";
import {
  listBankConnections,
  decryptAccessToken as decryptBankAccessToken,
} from "@/lib/imports/bank-connections";
import { revokeToken as revokeGoogleToken } from "@/lib/imports/gmail-client";
import { isPlaidConfigured, getPlaidClient } from "@/lib/imports/plaid-client";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";
import { logServerError } from "@/lib/observability/log-error";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

// Same bound as api/imports/plaid/disconnect's ITEM_REMOVE_TIMEOUT_MS — a
// slow/unresponsive Plaid API must not hold account deletion open
// indefinitely.
const ITEM_REMOVE_TIMEOUT_MS = 15_000;

const bodySchema = z.object({
  password: z.string().min(1).max(200),
});

// Permanently deletes the signed-in user's account and everything they
// own. Ownership is never taken from the request — every operation below
// is scoped to session.user.id, the authenticated caller's own id, so
// there is no id/param an attacker could substitute to reach another
// account (no IDOR surface here by construction, unlike a route that takes
// a target id as input).
//
// Order matters: 1) re-verify the password (a destructive, irreversible
// action must not be reachable off a stolen/XSS'd session cookie alone —
// getSession()'s SafeUser deliberately never carries passwordHash, see
// session.ts), 2) best-effort revoke every external OAuth/bank connection
// at its provider, 3) only then delete the local rows that held those
// tokens — same "revoke before the local copy is gone" ordering the
// standalone disconnect routes already use — 4) clear the session cookie.
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = await checkDeleteAccountRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a bit." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "Enter your password to confirm." },
      { status: 400 },
    );
  }

  // Fresh DB read, not session.user — see this route's own top comment.
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const passwordOk = row ? await verifyPassword(row.passwordHash, parsed.data.password) : false;
  if (!passwordOk) {
    logSecurityEvent("account_delete_wrong_password", { userId: session.user.id });
    return NextResponse.json({ error: "invalid_password", message: "Incorrect password." }, { status: 401 });
  }

  // Read before deleting — the rows (and the only copies of their
  // encrypted tokens) won't exist to read from once deleteUserAndAllData
  // runs.
  const [emailConnection, bankConnections] = await Promise.all([
    getEmailConnection(session.user.id, "gmail"),
    listBankConnections(session.user.id),
  ]);

  if (emailConnection) {
    try {
      // Same choice as api/imports/gmail/disconnect: revoking either token
      // invalidates the whole grant at Google's end (RFC 7009); prefer the
      // refresh token, fall back to the access token.
      const refreshToken = decryptEmailRefreshToken(emailConnection);
      await revokeGoogleToken(refreshToken ?? decryptEmailAccessToken(emailConnection));
    } catch (error) {
      // Never blocks account deletion — this app's own ability to use the
      // token is going away regardless of whether Google's revoke call
      // succeeds; see gmail/disconnect's own comment on the same tradeoff.
      logServerError("account.delete.revoke.gmail", error, { userId: session.user.id });
    }
  }

  const plaidConnections = bankConnections.filter((connection) => connection.provider === "plaid");
  if (isPlaidConfigured() && plaidConnections.length > 0) {
    const client = getPlaidClient();
    await Promise.all(
      plaidConnections.map(async (connection) => {
        try {
          await client.itemRemove(
            { access_token: decryptBankAccessToken(connection) },
            { timeout: ITEM_REMOVE_TIMEOUT_MS },
          );
        } catch (error) {
          logServerError("account.delete.revoke.plaid", error, { userId: session.user.id });
        }
      }),
    );
  }
  // TrueLayer connections: no revoke API exists to call here — same
  // documented gap as api/imports/truelayer/disconnect/route.ts. Their
  // encrypted tokens are still permanently removed below.

  try {
    await deleteUserAndAllData(session.user.id, session.user.email);
  } catch (error) {
    // Nothing local has been removed if this throws (the transaction
    // inside deleteUserAndAllData rolls back atomically) — the account
    // still exists and the caller can retry, rather than being told
    // they're deleted while rows remain.
    logServerError("account.delete.failed", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "delete_failed", message: "Couldn't delete your account. Try again or contact support." },
      { status: 500 },
    );
  }

  // The session row is already gone (cascade-deleted with the user above)
  // — this clears the browser's cookie, the one part of "signed out" a DB
  // delete alone can't do.
  await destroySession();

  return NextResponse.json({ ok: true });
}
