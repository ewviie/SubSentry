import { NextResponse, after } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { issueVerificationToken } from "@/lib/auth/email-verification";
import { sendVerificationEmail } from "@/lib/auth/email";
import { checkResendVerificationRateLimit, checkResendVerificationIpRateLimit } from "@/lib/auth/rate-limit";
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

// Always the same response — whether the email doesn't exist, belongs to
// an already-verified account, or genuinely gets a fresh link, the caller
// sees identical text. Distinguishing any of those cases here would let an
// attacker enumerate registered emails via this endpoint even though
// signup's own 409 already leaks that for other reasons (a separate,
// pre-existing tradeoff — see PROJECT_SECURITY_MAP.md); this endpoint
// doesn't need to add a second leak on top of it.
const GENERIC_RESPONSE = {
  ok: true,
  message: "If that email needs verification, a new link is on its way.",
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
    checkResendVerificationRateLimit(`${ip}:${email}`),
    checkResendVerificationIpRateLimit(ip),
  ]);
  if (!rateLimit.allowed || !ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  // Checked before the user lookup below (same ordering as signup, same
  // reasoning: reject cheaply before doing any work) and returns its own
  // distinct error rather than the enumeration-safe GENERIC_RESPONSE —
  // that's fine here specifically because a CAPTCHA failure happens before
  // any email/user lookup even runs, so it can't leak whether the address
  // is registered; it only ever reveals "you, the caller, didn't pass a
  // human check," the same for every email.
  if (isCaptchaConfigured()) {
    const captchaResult = await verifyCaptchaToken(captchaToken, getClientIp(request), {
      expectedAction: "resend_verification",
    });
    if (!captchaResult.ok) {
      logSecurityEvent("captcha_rejected", { path: "/api/auth/resend-verification", reason: captchaResult.reason });
      return NextResponse.json(
        { error: "captcha_failed", message: "Verification failed. Please try again." },
        { status: 400 },
      );
    }
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user || user.emailVerified) {
    // Matches the cost of the real path below (one issued-token insert plus
    // one email-send call) closely enough that response timing alone isn't
    // a reliable enumeration signal — not a cryptographic guarantee, just
    // removing the cheapest version of the leak.
    await sleep(50);
    return NextResponse.json(GENERIC_RESPONSE);
  }

  try {
    const { rawToken } = await issueVerificationToken(user.id);
    // after() — same reasoning and same primitive as
    // forgot-password/route.ts's identical change: the response below is
    // a fixed, generic message regardless of send outcome, so awaiting
    // the SMTP round-trip here only held the request open (and widened
    // the timing gap against the sleep(50) branch above) for no benefit
    // the caller could observe. after() (not a bare un-awaited promise)
    // because this is a normal serverless-deployment target, whose
    // execution can be frozen the moment the response is sent — see
    // forgot-password/route.ts's own comment for the full reasoning.
    // Failures are still logged, just without delaying the response.
    after(() =>
      sendVerificationEmail(email, rawToken).catch((error) => {
        logServerError("auth.resend-verification", error, { userId: user.id });
      }),
    );
  } catch (error) {
    logServerError("auth.resend-verification", error, { userId: user.id });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
