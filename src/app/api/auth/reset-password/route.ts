import { NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordResetToken } from "@/lib/auth/password-reset";
import { checkPasswordStrength } from "@/lib/auth/password";
import { checkResetPasswordRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// Token length is fixed (32 raw bytes, base64url-encoded) — an absurdly
// long "token" is never a real one and isn't worth a DB round trip to
// check. Password bound matches signup's own (min 8, max 200) — the exact
// same schema-level bound, re-validated here rather than trusted from
// whatever the client's form happened to enforce.
const bodySchema = z.object({
  token: z.string().trim().min(1).max(512),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  // Keyed by IP alone — a reset token isn't tied to a known account the way
  // a login attempt is, so there's no email to key a second bucket on the
  // way login's checkLoginPerEmailRateLimit does. Same reasoning as
  // checkVerifyEmailRateLimit. Checked before the body is ever read: this
  // key doesn't depend on anything in it, so a caller who's already
  // rate-limited is rejected before paying for a stream read + JSON parse,
  // not after.
  const rateLimit = await checkResetPasswordRateLimit(getClientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A too-short/too-long password is a distinct, actionable message; an
    // invalid token shape collapses to the same "invalid request" as
    // everything else below — neither branch reveals anything about which
    // account (if any) the token belongs to.
    const isPasswordIssue = issue?.path[0] === "password";
    return NextResponse.json(
      {
        error: isPasswordIssue ? "weak_password" : "invalid_request",
        message: isPasswordIssue ? issue.message : "Invalid request.",
      },
      { status: 400 },
    );
  }

  const { token, password } = parsed.data;

  // checkPasswordStrength also takes an email to reject "password contains
  // part of your email" — not available here (the token, not the caller,
  // identifies the account, and revealing it before the token is even
  // validated would be an enumeration leak). The common-password/
  // trivial-sequence checks below don't need it.
  const strength = checkPasswordStrength(password, "");
  if (!strength.ok) {
    return NextResponse.json({ error: "weak_password", message: strength.reason }, { status: 400 });
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.reason === "expired" ? "expired_token" : "invalid_token",
        message:
          result.reason === "expired"
            ? "This reset link has expired. Request a new one."
            : "This reset link is invalid or has already been used.",
      },
      { status: 400 },
    );
  }

  // Deliberately does NOT create a session here — every existing session
  // (including whatever browser this request came from) was just revoked
  // by consumePasswordResetToken. Requiring an explicit log-in with the new
  // password is the safer default: auto-login off the back of a clicked
  // email link means a prefetched/scanned link could silently sign in as
  // the account owner without them ever entering the new password
  // themselves. See login's own flow — untouched — for how that happens.
  return NextResponse.json({ ok: true });
}
