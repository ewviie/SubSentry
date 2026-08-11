import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, loginAttempts } from "@/lib/db/schema";

// Permanently deletes a user and every row that belongs to them. Almost
// every user-owned table's userId column is declared `onDelete: "cascade"`
// (see schema.ts: sessions, subscriptions, imports, bankConnections,
// emailConnections, emailVerificationTokens, passwordResetTokens) — so
// deleting the users row itself is what actually removes all of it, one
// statement enforced by Postgres, rather than a hand-maintained list of
// "also delete from X, Y, Z" this file would otherwise have to keep in
// sync as the schema grows.
//
// loginAttempts is the one exception: it's keyed by the login *email*, not
// a userId foreign key (schema.ts — it has to survive a login attempt
// against an email with no account at all), so cascade never touches it.
// Cleaned up explicitly here so a stale lockout/failure count can't outlive
// the account it belonged to and land on whoever signs up with this email
// next.
//
// checkoutSessions (onDelete: "set null") and stripeEvents are deliberately
// left untouched by this function — both are Stripe's own billing/audit
// trail keyed by Stripe's own ids, not "this user's application data" the
// way a tracked subscription or a bank connection is; see their own
// schema.ts comments.
//
// Callers are expected to have already revoked any external OAuth/bank
// tokens at the provider (Gmail, Plaid) *before* calling this — see
// api/account/route.ts — the same "revoke before the local copy is gone"
// ordering the standalone disconnect routes already follow. This function
// only ever deletes local rows; it makes no outbound calls itself.
//
// A single transaction, not two independent statements: a crash or
// connection drop between "delete the user" and "delete their
// login-attempts row" must not leave a stray loginAttempts row behind for
// an account that no longer exists.
export async function deleteUserAndAllData(userId: string, email: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.id, userId));
    await tx.delete(loginAttempts).where(eq(loginAttempts.email, email));
  });
}
