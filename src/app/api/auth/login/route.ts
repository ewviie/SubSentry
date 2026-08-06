import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { checkLoginRateLimit, checkLoginPerEmailRateLimit, checkLoginIpRateLimit } from "@/lib/auth/rate-limit";
import { checkLockout, recordFailedLogin, resetLoginAttempts } from "@/lib/auth/lockout";
import { getClientIp } from "@/lib/http/client-ip";
import { isContentLengthWithinLimit, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ACCOUNT_LOCKED = {
  error: "account_locked",
  message: "Too many failed attempts. Try again in 15 minutes.",
} as const;

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
  if (!isContentLengthWithinLimit(request, MAX_JSON_BODY_BYTES)) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const { email, password } = parsed.data;

  const ip = getClientIp(request);
  const [rateLimit, perEmailRateLimit, ipRateLimit] = await Promise.all([
    checkLoginRateLimit(`${ip}:${email}`),
    checkLoginPerEmailRateLimit(email),
    checkLoginIpRateLimit(ip),
  ]);
  if (!rateLimit.allowed || !perEmailRateLimit.allowed || !ipRateLimit.allowed) {
    logSecurityEvent("login_rate_limited", { ip, email });
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  // DB-backed lockout (durable across restarts/instances), independent of
  // and layered on top of the in-memory rate limits above — see
  // src/lib/auth/lockout.ts for why both exist.
  const lockout = await checkLockout(email);
  if (lockout.locked) {
    logSecurityEvent("login_locked_out", { ip, email });
    return NextResponse.json(ACCOUNT_LOCKED, { status: 423 });
  }
  if (lockout.delayMs > 0) {
    await sleep(lockout.delayMs);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyPassword(DUMMY_HASH, password).catch(() => false);
  if (!user || !passwordOk) {
    await recordFailedLogin(email);
    logSecurityEvent("login_failed", { ip, email });
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  await resetLoginAttempts(email);

  // No emailVerified gate here — email verification is disabled for the
  // active auth flow (see signup/route.ts's comment: CAPTCHA + rate
  // limiting + lockout are the bot/abuse protection instead). The
  // emailVerified column and the rest of the verification implementation
  // are kept intact for a future re-enable; this route just doesn't
  // consult it right now.
  await createSession(user.id);

  return NextResponse.json({ ok: true });
}
