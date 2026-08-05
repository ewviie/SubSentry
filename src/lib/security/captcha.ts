// Cloudflare Turnstile server-side verification. Chosen over hCaptcha and
// reCAPTCHA Enterprise: privacy-friendly (no ad-tracking cross-site cookie,
// no personal data resale — Cloudflare's own privacy commitments are a
// closer fit for a product whose landing page already promises "we never
// sell your data" than Google's reCAPTCHA), free at any volume (reCAPTCHA
// Enterprise bills per assessment; hCaptcha's free tier is more limited),
// and its "managed" widget mode is genuinely low-friction — most real users
// never see an interactive challenge at all, only bots and clearly
// suspicious traffic do. The verification API shape (POST token+secret,
// get back {success, "error-codes", ...}) is close to a drop-in match for
// reCAPTCHA's if this ever needs to change providers later.
//
// Same "leave the env unset, feature degrades gracefully" convention as
// every other optional integration in this app (Plaid/TrueLayer/Stripe/AI/
// email) — see isCaptchaConfigured() below. Unlike email.ts's
// production-throw fix, an unconfigured CAPTCHA doesn't get the same
// treatment: skipping it degrades to "signup/resend are only protected by
// the existing rate limits," a real but bounded gap, not an active leak of
// a credential the way logging a verification link would be. Documented
// as a deployment checklist item, not silently accepted — see
// AUTH_BOT_PROTECTION_REPORT.md.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Bounds how long a signup/resend request can be held up waiting on
// Cloudflare before giving up — same reasoning as
// rate-limit-distributed.ts's UPSTASH_TIMEOUT_MS: a hung third-party call
// must not hang the request indefinitely. Unlike that module, a CAPTCHA
// timeout fails *closed* (rejects the request) rather than falling back to
// "allow" — this endpoint's whole job is turning away non-humans, so
// "Cloudflare didn't answer in time" is treated the same as "Cloudflare
// said no," not "let it through."
const VERIFY_TIMEOUT_MS = 5000;

export function isCaptchaConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export type CaptchaVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_token" | "invalid_token" | "verify_request_failed" | "hostname_mismatch" | "action_mismatch";
    };

interface TurnstileSiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
}

// `expectedHostname`/`expectedAction` are both optional and only enforced
// when both the expectation and the response's own field are present.
// Hostname: this app doesn't hard-require NEXT_PUBLIC_APP_URL (see
// layout.tsx's own comment on why: no production domain is configured yet
// in this repo's state), so this check degrades to "not checked" rather
// than breaking every request the moment someone deploys without setting
// it. Action: binds a token to the specific flow it was minted for (the
// widget renders with data-action="signup" / "resend_verification" — see
// turnstile-widget.tsx) so a token solved on one form can't be replayed
// against the other; also degrades to "not checked" if a caller doesn't
// pass one, same reasoning.
export async function verifyCaptchaToken(
  token: string | undefined | null,
  remoteIp: string,
  options?: { expectedHostname?: string; expectedAction?: string },
): Promise<CaptchaVerifyResult> {
  if (!token || token.trim().length === 0) {
    return { ok: false, reason: "missing_token" };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Should never be reached in practice — callers check
    // isCaptchaConfigured() first and skip verification entirely when
    // false. Fails closed rather than silently passing if a caller ever
    // forgets that check, since "verify a token with no secret configured"
    // has no safe "yes" answer.
    return { ok: false, reason: "verify_request_failed" };
  }

  let response: Response;
  try {
    response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    // Network error, timeout, or DNS failure — fail closed (see
    // VERIFY_TIMEOUT_MS's comment on why this differs from the rate
    // limiter's fail-open-to-fallback pattern).
    return { ok: false, reason: "verify_request_failed" };
  }

  if (!response.ok) {
    return { ok: false, reason: "verify_request_failed" };
  }

  let body: TurnstileSiteverifyResponse;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "verify_request_failed" };
  }

  if (!body.success) {
    return { ok: false, reason: "invalid_token" };
  }

  if (options?.expectedHostname && body.hostname && body.hostname !== options.expectedHostname) {
    return { ok: false, reason: "hostname_mismatch" };
  }

  if (options?.expectedAction && body.action && body.action !== options.expectedAction) {
    return { ok: false, reason: "action_mismatch" };
  }

  return { ok: true };
}
