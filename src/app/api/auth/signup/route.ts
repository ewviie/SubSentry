import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, checkPasswordStrength } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { checkSignupRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";
import { isContentLengthWithinLimit, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";
import { isCaptchaConfigured, verifyCaptchaToken } from "@/lib/security/captcha";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(120).optional(),
  // Absent/empty whenever CAPTCHA is unconfigured (see isCaptchaConfigured
  // below) — max length is generous but bounded (a real Turnstile token is
  // a few hundred characters; this just keeps a garbage payload from being
  // unboundedly large before it's rejected).
  // .nullish(), not .optional() — the widget's token state starts as
  // `null` (no token solved yet), and JSON.stringify keeps an explicit
  // `null` in the request body (unlike `undefined`, which it drops), so
  // the schema has to accept both.
  captchaToken: z.string().max(4000).nullish(),
});

export async function POST(request: Request) {
  if (!isContentLengthWithinLimit(request, MAX_JSON_BODY_BYTES)) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const rateLimit = await checkSignupRateLimit(getClientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many signups from this network. Try again later." },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "invalid_request",
        message: issue?.message ?? "Invalid input.",
        // Lets the client mark the specific field aria-invalid and move
        // focus to it instead of just announcing a generic banner. Only
        // ever "email" | "password" | "name" here — bodySchema has no
        // nested fields, so path[0] is always the top-level key itself.
        field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
      },
      { status: 400 },
    );
  }

  const { email, password, name, captchaToken } = parsed.data;

  // Cheap, no DB/network involved — checked right after schema parsing,
  // same "reject cheaply before expensive work" ordering as the CAPTCHA
  // check below. Zod's min(8) alone doesn't stop "password123"/"aaaaaaaa".
  const strength = checkPasswordStrength(password, email);
  if (!strength.ok) {
    return NextResponse.json(
      { error: "weak_password", message: strength.reason, field: "password" },
      { status: 400 },
    );
  }

  // Server-side CAPTCHA verification — never trusts that a token merely
  // being present means it's valid; verifyCaptchaToken makes its own call
  // to Cloudflare regardless of what the client claims. Placed after the
  // cheap checks above (content-length, rate limit, schema) but before any
  // expensive work (the DB lookup below, and especially the argon2 hash
  // further down — bcrypt/argon2 is deliberately slow, which is exactly
  // the CPU cost a scripted signup flood would be trying to make this
  // server pay over and over) so a failed CAPTCHA is rejected as cheaply
  // as possible. Skipped entirely when unconfigured, same convention as
  // every other optional integration in this app — see captcha.ts.
  if (isCaptchaConfigured()) {
    const captchaResult = await verifyCaptchaToken(captchaToken, getClientIp(request), { expectedAction: "signup" });
    if (!captchaResult.ok) {
      logSecurityEvent("captcha_rejected", { path: "/api/auth/signup", reason: captchaResult.reason });
      return NextResponse.json(
        { error: "captcha_failed", message: "Verification failed. Please try again." },
        { status: 400 },
      );
    }
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "email_taken", message: "An account with that email already exists.", field: "email" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    // The check above is a fast, friendly-error common case — it doesn't
    // close the race where two signups for the same email land between
    // the check and this insert. users.email has a DB-level unique
    // constraint (schema.ts), so that race surfaces here as a Postgres
    // unique-violation (23505) instead of a duplicate row, and gets mapped
    // to the same 409 rather than bubbling up as an unhandled 500.
    //
    // No explicit emailVerified override here (unlike the prior
    // email-verification flow) — email verification is disabled for the
    // active signup flow (bot protection is CAPTCHA + rate limiting +
    // lockout instead; see verifyCaptchaToken above), so new accounts fall
    // through to the column's own default of `true`. This is deliberate,
    // not an oversight: the email-verification implementation
    // (lib/auth/email-verification.ts, api/auth/verify-email,
    // api/auth/resend-verification) is kept intact and isolated for a
    // future re-enable, but a user created while it's inactive was never
    // asked to verify anything, so marking them `false` would misrepresent
    // them as "pending verification" if the feature is switched back on.
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: name || null })
      .returning({ id: users.id });
    userId = user.id;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return NextResponse.json(
        { error: "email_taken", message: "An account with that email already exists.", field: "email" },
        { status: 409 },
      );
    }
    throw error;
  }

  await createSession(userId);

  return NextResponse.json({ ok: true });
}
