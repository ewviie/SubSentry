import { randomBytes, createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailVerificationTokens, users } from "@/lib/db/schema";

// 24h — long enough that a real user checking email a few hours later
// still has a working link, short enough that a token found in an old,
// leaked email thread is no longer useful.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Same hash-only-storage pattern as sessions.tokenHash (see
// src/lib/auth/session.ts) — a DB leak alone can't produce a working
// verification link, only the raw token mailed to the user can. Looking up
// by an indexed equality match on the hash (not comparing raw bytes in
// application code) is what session.ts already relies on for the same
// "constant-time enough" property: Postgres's b-tree equality lookup on an
// indexed/unique column doesn't leak a byte-by-byte timing signal the way a
// naive `for` loop string comparison would.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedVerificationToken {
  rawToken: string;
  expiresAt: Date;
}

// Upserts on the table's unique userId constraint (schema.ts) — one atomic
// statement, not a separate delete-then-insert. The prior two-statement
// version left a real window: two concurrent issue calls for the same user
// (e.g. a double-clicked resend, or a signup racing an immediate resend)
// could each run their delete before the other's insert landed, leaving
// more than one valid token outstanding at once — a real but narrow
// violation of "issuing a fresh token invalidates every previous link,"
// silently defeating the invalidation guarantee that resend-verification's
// docs above assume. An upsert closes the window: Postgres resolves a
// concurrent ON CONFLICT pair atomically, so exactly one row (and one valid
// token) ever exists per user, no matter how the two calls interleave.
export async function issueVerificationToken(userId: string): Promise<IssuedVerificationToken> {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db
    .insert(emailVerificationTokens)
    .values({ userId, tokenHash: hashToken(rawToken), expiresAt })
    .onConflictDoUpdate({
      target: emailVerificationTokens.userId,
      set: { tokenHash: hashToken(rawToken), expiresAt },
    });

  return { rawToken, expiresAt };
}

export type ConsumeTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

// Single-use by deletion, not a `usedAt` flag: once consumed (or found
// expired), the row is gone, so there's no "used" state a bug could ever
// mistake for "still valid."
//
// Claims the row via a single atomic `DELETE ... RETURNING`, not a
// SELECT-then-DELETE pair (even inside a transaction) — under Postgres's
// default READ COMMITTED isolation, a plain SELECT takes no row lock, so
// two concurrent requests presenting the same token (e.g. an email client
// prefetching the link twice) could both read the row as valid before
// either one's DELETE commits, both proceeding to "verify" instead of
// exactly one. DELETE...RETURNING has no such gap: Postgres guarantees at
// most one concurrent DELETE with a matching WHERE clause actually removes
// and returns the row; a second, simultaneous DELETE against the same
// tokenHash atomically sees zero rows, full stop, no separate lock needed.
export async function consumeVerificationToken(rawToken: string): Promise<ConsumeTokenResult> {
  const tokenHash = hashToken(rawToken);

  const [row] = await db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .returning();

  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  await db
    .update(users)
    .set({ emailVerified: true, emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, row.userId));

  return { ok: true, userId: row.userId };
}

// Best-effort housekeeping for tokens nobody ever clicked — not required
// for correctness (an expired row is already treated as invalid and
// deleted the moment anyone tries to use it) but keeps the table from
// growing unbounded with dead rows from abandoned signups. Safe to call
// from a cron/maintenance script; not wired into any request path.
export async function deleteExpiredVerificationTokens(): Promise<void> {
  await db.delete(emailVerificationTokens).where(lt(emailVerificationTokens.expiresAt, new Date()));
}
