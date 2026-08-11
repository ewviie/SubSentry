import { randomBytes, createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { passwordResetTokens, sessions, users } from "@/lib/db/schema";
import { hashPassword } from "./password";

// 1 hour — deliberately shorter than email verification's 24h
// (email-verification.ts). A password-reset link is a full account-takeover
// credential if intercepted (unlike a verification link, which only flips a
// boolean), so it gets a tighter window: long enough that a real user
// checking email a few minutes later still has a working link, short enough
// that a link found in an old, leaked email thread is no longer useful.
const TOKEN_TTL_MS = 60 * 60 * 1000;

// Same hash-only-storage pattern as sessions.tokenHash and
// emailVerificationTokens.tokenHash — a DB leak alone can't produce a
// working reset link, only the raw token mailed to the user can.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedPasswordResetToken {
  rawToken: string;
  expiresAt: Date;
}

// Upserts on the table's unique userId constraint (schema.ts) — one atomic
// statement, not a separate delete-then-insert. Same reasoning as
// issueVerificationToken: a naive delete-then-insert leaves a window where
// two concurrent issue calls for the same user (a double-clicked "forgot
// password") could both land a row, leaving more than one valid reset link
// outstanding at once. The unique constraint makes "at most one outstanding
// reset token per user" a DB-enforced invariant, and issuing a fresh one
// always invalidates whatever link was sent before it.
export async function issuePasswordResetToken(userId: string): Promise<IssuedPasswordResetToken> {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db
    .insert(passwordResetTokens)
    .values({ userId, tokenHash: hashToken(rawToken), expiresAt })
    .onConflictDoUpdate({
      target: passwordResetTokens.userId,
      set: { tokenHash: hashToken(rawToken), expiresAt },
    });

  return { rawToken, expiresAt };
}

export type ConsumePasswordResetTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

// Single-use by deletion (not a `usedAt` flag), claimed via an atomic
// DELETE...RETURNING rather than SELECT-then-DELETE — same reasoning as
// consumeVerificationToken: under Postgres's default READ COMMITTED
// isolation, a plain SELECT takes no row lock, so two concurrent requests
// presenting the same token could both read it as valid before either
// DELETE commits. DELETE...RETURNING guarantees at most one concurrent
// caller ever sees the row.
//
// The entire operation — claiming the token, hashing the new password,
// writing it, and revoking every session — runs as ONE transaction, not
// (as this used to be split) an initial DELETE that committed on its own
// followed by password-hashing and a second, separate transaction. That
// gap was real: if hashPassword or the writes below ever failed after the
// token's DELETE had already committed by itself, the token was gone
// forever but the password was never actually changed — the user would be
// locked out of the reset flow entirely, with no valid link left and no
// changed password, and no way to recover except starting over from
// "forgot password". Wrapping everything below in one transaction means a
// failure anywhere inside it rolls back the token DELETE along with
// everything else, restoring the token exactly as it was so the same link
// still works on retry — only a *successful* completion of the whole unit
// ever actually consumes the token.
//
// The DELETE...RETURNING itself keeps its original atomic-claim behavior,
// now with an even smaller race window than before: under READ COMMITTED,
// the DELETE takes a row lock for the rest of this transaction, so a
// second concurrent request presenting the same token blocks until this
// one either commits (the row is gone — the second request correctly sees
// zero rows and reports "invalid") or rolls back (the row reappears,
// leaving the second request free to claim it itself). Two concurrent
// callers can never both succeed, and a call that fails never leaves the
// token half-consumed.
//
// On success: sets the new password hash AND deletes every existing
// session for the user (sessions table, keyed by userId — see schema.ts's
// sessions_user_id_idx). A password reset is exactly the moment a stolen
// session (XSS, a shared/public machine, a leaked cookie) should stop
// working — leaving old sessions alive through a reset would mean an
// attacker who already has a live session keeps it even after the real
// owner "secures" their account.
export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string,
): Promise<ConsumePasswordResetTokenResult> {
  const tokenHash = hashToken(rawToken);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .returning();

    if (!row) return { ok: false, reason: "invalid" } as const;

    // An expired token is still consumed here, not restored — that's
    // deliberate single-use hygiene, unchanged from before this fix: only
    // a genuine failure past this point (not "the token turned out to be
    // too old") is what should leave a token usable again.
    if (row.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "expired" } as const;
    }

    const passwordHash = await hashPassword(newPassword);

    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));

    return { ok: true, userId: row.userId } as const;
  });
}

// Best-effort housekeeping for tokens nobody ever clicked — not required
// for correctness (an expired row is already treated as invalid and deleted
// the moment anyone tries to use it) but keeps the table from growing
// unbounded with dead rows from abandoned reset requests. Safe to call from
// a cron/maintenance script; not wired into any request path. Mirrors
// deleteExpiredVerificationTokens in email-verification.ts.
export async function deleteExpiredPasswordResetTokens(): Promise<void> {
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, new Date()));
}
