import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { SESSION_COOKIE } from "./constants";

const SESSION_DAYS = 30;

// Never carries passwordHash — getSession()'s result is passed around
// broadly (Server Components, API routes), and the hash has no business
// leaving lib/auth. Password verification reads it via its own direct query
// (see api/auth/login/route.ts), not through this type.
export type SafeUser = Omit<User, "passwordHash">;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Cookie carries only an opaque random token; the DB stores its hash, so a
// database leak alone doesn't hand out valid session tokens.
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

// Authoritative check — cached per request so repeated calls in the same
// render pass don't repeat the DB lookup. Middleware only checks cookie
// presence for a cheap redirect; this is what actually validates it.
export const getSession = cache(async (): Promise<{ user: SafeUser } | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      stripeCustomerId: users.stripeCustomerId,
      emailVerified: users.emailVerified,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    // Lazily purge on the read path — an expired row is already inert (it
    // never validates), but without this it lingers in the table forever
    // for any session that expires without an explicit logout. This only
    // catches rows for tokens someone actually presents again after expiry;
    // see scripts/cleanup-expired-sessions.ts for the scheduled sweep that
    // catches abandoned ones too.
    //
    // Best-effort: a transient DB error here (connection blip, timeout)
    // must not turn a routine "session expired" outcome into an unhandled
    // exception for every caller of getSession()/requireUser() — the
    // scheduled sweep will pick up anything a failed delete leaves behind.
    await db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .catch(() => {});
    return null;
  }

  const { expiresAt: _expiresAt, ...user } = row;
  return { user };
});

export async function requireUser(): Promise<SafeUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}
