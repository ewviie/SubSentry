import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { checkLoginRateLimit, checkLoginPerEmailRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
});

const INVALID_CREDENTIALS = {
  error: "invalid_credentials",
  message: "Incorrect email or password.",
} as const;

// Verified against on every login where the account doesn't exist, so a
// missing user takes the same argon2 time as a wrong password — otherwise
// "no such user" is measurably faster and leaks which emails are registered.
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$UOWzGGOj1ZC7OafrWmPMfA$hV/H0gVzzT4kYze3GtnETvgmBzTqVA0pe4WzvkVUdHI";

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const { email, password } = parsed.data;

  const rateLimit = checkLoginRateLimit(`${getClientIp(request)}:${email}`);
  const perEmailRateLimit = checkLoginPerEmailRateLimit(email);
  if (!rateLimit.allowed || !perEmailRateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword(DUMMY_HASH, password).catch(() => false);
  if (!user || !passwordOk) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  await createSession(user.id);

  return NextResponse.json({ ok: true });
}
