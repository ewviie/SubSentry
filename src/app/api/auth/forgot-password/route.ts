import { NextResponse, after } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { issuePasswordResetToken } from "@/lib/auth/password-reset";
import { sendPasswordResetEmail } from "@/lib/auth/email";
import { checkForgotPasswordRateLimit, checkForgotPasswordIpRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";
import { logServerError } from "@/lib/observability/log-error";
import { isCaptchaConfigured, verifyCaptchaToken } from "@/lib/security/captcha";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  // .nullish() — see signup/route.ts's identical field for why (the
  // widget's token state starts as `null`, which JSON.stringify preserves).
  captchaToken: z.string().max(4000).nullish(),
});

// Always the same response — whether the email doesn't exist or genuinely
// gets a fresh reset link, the caller sees identical text. Distinguishing
// those cases here would let an attacker enumerate registered emails, the
// exact same reasoning as resend-verification's GENERIC_RESPONSE (see that
// route's own comment).
const GENERIC_RESPONSE = {
  ok: true,
  message: "If that email has an account, a reset link is on its way.",
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) {
    // The shape of the input, not the account, is what's wrong here — an
    // empty/malformed body isn't an enumeration-relevant response.
    return NextResponse.json({ error: "invalid_request", message: "Enter a valid email." }, { status: 400 });
  }

  const { email, captchaToken } = parsed.data;

  const ip = getClientIp(request);
  const [rateLimit, ipRateLimit] = await Promise.all([
    checkForgotPasswordRateLimit(`${ip}:${email}`),
    checkForgotPasswordIpRateLimit(ip),
  ]);
  if (!rateLimit.allowed || !ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  // Checked before the user lookup below, same ordering/reasoning as
  // resend-verification: a failed CAPTCHA happens before any email/user
  // lookup runs, so it can't leak whether the address is registered.
  if (isCaptchaConfigured()) {
    const captchaResult = await verifyCaptchaToken(captchaToken, ip, { expectedAction: "forgot_password" });
    if (!captchaResult.ok) {
      logSecurityEvent("captcha_rejected", { path: "/api/auth/forgot-password", reason: captchaResult.reason });
      return NextResponse.json(
        { error: "captcha_failed", message: "Verification failed. Please try again." },
        { status: 400 },
      );
    }
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    // Matches the cost of the real path below (one issued-token insert plus
    // one email-send call) closely enough that response timing alone isn't
    // a reliable enumeration signal — not a cryptographic guarantee, just
    // removing the cheapest version of the leak. Same tradeoff already
    // accepted in resend-verification/route.ts.
    await sleep(50);
    return NextResponse.json(GENERIC_RESPONSE);
  }

  try {
    const { rawToken } = await issuePasswordResetToken(user.id);
    // after(), not awaited inline — the response below already commits to
    // a fixed, generic message regardless of send outcome (see
    // GENERIC_RESPONSE's own comment), so nothing the caller sees depends
    // on this finishing first. Awaiting it used to mean a slow or
    // misconfigured SMTP provider held this request open for as long as
    // the send took (observed, against a real provider, taking several
    // seconds up to the connection timeout) — worse, it also widened the
    // exact timing gap the sleep(50) above exists to close: the "no such
    // account" branch stayed fixed at 50ms while this one scaled with
    // SMTP latency, an accidental enumeration side-channel on top of the
    // deliberate one this route already guards against.
    //
    // next/server's after() (not a bare un-awaited promise) specifically
    // because this app is a normal target for serverless deployment
    // (Vercel): a serverless function's execution can be frozen the
    // instant its response is sent, which would silently cut off a plain
    // fire-and-forget promise mid-send. after() is the framework's own
    // "run this once the response has gone out, but guarantee it still
    // completes" primitive — the correct tool for exactly this, not a
    // workaround. Failures are still logged, just without delaying the
    // response.
    after(() =>
      sendPasswordResetEmail(email, rawToken).catch((error) => {
        logServerError("auth.forgot-password", error, { userId: user.id });
      }),
    );
  } catch (error) {
    logServerError("auth.forgot-password", error, { userId: user.id });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
