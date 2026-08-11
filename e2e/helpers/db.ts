import postgres from "postgres";
import { createHash } from "node:crypto";

// A minimal, dependency-free (no Drizzle/path-alias) DB helper for E2E
// tests only — Playwright doesn't share vitest's tsconfig path resolution,
// and pulling in the full `@/lib/db` module here would couple test
// infrastructure to the app's Next.js module graph for no real benefit.
// Tests use this only to set up/verify state a real user can't reach
// through the UI (reading a verification token straight from the DB, the
// same way a real email would deliver it).
//
// A fresh connection per call, not one shared singleton — the local PGlite
// dev server (see src/lib/db/index.ts's own extensive comment on this) can
// drop an idle or long-lived connection under sustained load, and a
// singleton here would then fail every subsequent call for the rest of the
// run. Short-lived, single-query connections sidestep that; this is E2E
// test infrastructure talking to a throwaway dev DB, not a pooled
// production client, so the extra connection overhead per call is a
// non-issue.
function connect() {
  return postgres(process.env.DATABASE_URL || "postgres://doubloon:doubloon@127.0.0.1:55432/doubloon", {
    max: 1,
    prepare: false,
  });
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function getRawVerificationTokenForEmail(email: string): Promise<string | null> {
  // The DB only ever stores the *hash* of a verification token (see
  // src/lib/auth/email-verification.ts) — there is no raw token to read
  // back. Tests instead read the verification link straight out of the
  // demo-mode console log path... which isn't queryable either. So this
  // helper mints its own token through the same code path a real signup
  // uses: it looks up the user, deletes any existing token row, and
  // inserts a fresh one with a token *this test controls* — mirroring
  // issueVerificationToken()'s own logic rather than importing it, to
  // keep this file Next.js/Drizzle-free.
  const sql = connect();
  try {
    const [user] = await sql<{ id: string }[]>`select id from users where email = ${email} limit 1`;
    if (!user) return null;

    const rawToken = createHash("sha256").update(`${email}:${Date.now()}:${Math.random()}`).digest("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await sql`delete from email_verification_tokens where user_id = ${user.id}`;
    await sql`insert into email_verification_tokens (user_id, token_hash, expires_at) values (${user.id}, ${tokenHash}, ${expiresAt})`;

    return rawToken;
  } finally {
    await sql.end();
  }
}

// Same reasoning and pattern as getRawVerificationTokenForEmail above: the
// DB only ever stores a password-reset token's hash (src/lib/auth/
// password-reset.ts), so this mints its own token through the same shape
// issuePasswordResetToken() writes, mirroring its logic rather than
// importing it, to keep this file Next.js/Drizzle-free.
export async function getRawPasswordResetTokenForEmail(email: string): Promise<string | null> {
  const sql = connect();
  try {
    const [user] = await sql<{ id: string }[]>`select id from users where email = ${email} limit 1`;
    if (!user) return null;

    const rawToken = createHash("sha256").update(`${email}:${Date.now()}:${Math.random()}`).digest("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await sql`delete from password_reset_tokens where user_id = ${user.id}`;
    await sql`insert into password_reset_tokens (user_id, token_hash, expires_at) values (${user.id}, ${tokenHash}, ${expiresAt})`;

    return rawToken;
  } finally {
    await sql.end();
  }
}

export async function deleteTestUser(email: string): Promise<void> {
  const sql = connect();
  try {
    await sql`delete from users where email = ${email}`;
  } finally {
    await sql.end();
  }
}

// No-op kept so existing `test.afterAll(closeDb)` call sites don't need
// touching — each helper call now owns and closes its own short-lived
// connection instead of one shared one.
export async function closeDb(): Promise<void> {}
