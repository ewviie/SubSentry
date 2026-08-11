import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { checkLoginRateLimit, checkLoginPerEmailRateLimit, checkLoginIpRateLimit } from "@/lib/auth/rate-limit";
import { checkLockout, recordFailedLogin, resetLoginAttempts, shouldRequireCaptcha } from "@/lib/auth/lockout";
import { getClientIp } from "@/lib/http/client-ip";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";
import { isCaptchaConfigured, verifyCaptchaToken } from "@/lib/security/captcha";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ACCOUNT_LOCKED = {
  error: "account_locked",
  message: "Too many failed attempts. Try again in 15 minutes.",
} as const;

// checkLockout()'s delayMs is already 0 below 2 prior failures and >0 at or
// above it (see lockout.ts's delayForAttempt) — reused directly rather than
// adding a second failedCount read, so "has this email already failed at
// least twice" has exactly one source of truth. Gating here, not at the
// lock threshold itself (5), is what closes the actual attack: without
// this, an email-keyed lockout is a free, unauthenticated way to deny a
// specific victim login access forever (5 cheap wrong-password POSTs, no
// CAPTCHA anywhere on this route, repeat every 15 minutes) — verified as a
// live, real gap before this fix (login had no CAPTCHA at all, unlike
// signup/resend-verification). Requiring a solved CAPTCHA once failures
// start compounding, before the password is even checked, means an
// attacker can no longer grind toward a lock without paying a real,
// per-attempt human-verification cost, the same protection signup already
// gets — while a normal user's first (or even first accidental second)
// wrong-password attempt never sees a CAPTCHA at all.
// Same "leave TURNSTILE unset, this degrades to no extra gate" convention
// as every other optional integration in this app — documented, not
// silently accepted (see captcha.ts's own comment on the same tradeoff).

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
  // .nullish() — see signup/route.ts's identical field for why (the
  // widget's token state starts as `null`, which JSON.stringify preserves).
  captchaToken: z.string().max(4000).nullish(),
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
  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const { email, password, captchaToken } = parsed.data;

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

  // Checked before the password is touched at all, same ordering/reasoning
  // as signup's CAPTCHA check — a failed/missing CAPTCHA here never costs a
  // real password-verification attempt, and deliberately does NOT call
  // recordFailedLogin: an attacker who can't solve the CAPTCHA can't make
  // any further progress toward re-locking this account, closing the
  // lockout-as-DoS path this gate exists for.
  if (isCaptchaConfigured() && shouldRequireCaptcha(lockout.delayMs)) {
    const captchaResult = await verifyCaptchaToken(captchaToken, ip, { expectedAction: "login" });
    if (!captchaResult.ok) {
      logSecurityEvent("captcha_rejected", { path: "/api/auth/login", reason: captchaResult.reason });
      return NextResponse.json(
        { error: "captcha_required", message: "Verify you're human to keep trying." },
        { status: 400 },
      );
    }
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
