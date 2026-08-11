import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeVerificationToken } from "@/lib/auth/email-verification";
import { createSession } from "@/lib/auth/session";
import { checkVerifyEmailRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// Token length is fixed (32 raw bytes, base64url-encoded) — an absurdly
// long "token" is never a real one and isn't worth a DB round trip to check.
const bodySchema = z.object({
  token: z.string().trim().min(1).max(512),
});

export async function POST(request: Request) {
  // Keyed by IP alone — a verification token isn't tied to a known account
  // the way a login attempt is, so there's no email to key a second bucket
  // on the way login's checkLoginPerEmailRateLimit does. Checked before the
  // body is ever read: this key doesn't depend on anything in it, so a
  // caller who's already rate-limited is rejected before paying for a
  // stream read + JSON parse, not after.
  const rateLimit = await checkVerifyEmailRateLimit(getClientIp(request));
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
    return NextResponse.json({ error: "invalid_request", message: "Invalid request." }, { status: 400 });
  }

  const result = await consumeVerificationToken(parsed.data.token);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.reason === "expired" ? "expired_token" : "invalid_token",
        message:
          result.reason === "expired"
            ? "This verification link has expired. Request a new one."
            : "This verification link is invalid or has already been used.",
      },
      { status: 400 },
    );
  }

  // Verifying and logging in are the same moment from the user's
  // perspective — they clicked one link and expect to land signed in.
  await createSession(result.userId);

  return NextResponse.json({ ok: true });
}
