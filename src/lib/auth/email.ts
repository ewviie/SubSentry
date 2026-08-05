// Same "leave the key unset and the feature degrades gracefully" pattern as
// src/lib/ai/provider.ts (ANTHROPIC_API_KEY absent -> demo provider) and
// src/lib/billing/plan.ts (STRIPE_SECRET_KEY absent -> feature hidden): no
// email provider is configured for this app yet, so RESEND_API_KEY absent
// means the verification link is logged server-side instead of mailed —
// the signup/verify flow stays fully functional and testable without a
// real email vendor. Swap the body of sendVerificationEmail for a real
// Resend (or any provider) API call once one is chosen; every caller
// already treats this as async and failure-tolerant.
function buildVerificationUrl(rawToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = new URL("/verify-email", base);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

export function isEmailSendingConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Bounded retry for the Resend call only — a transient network blip or a
// momentary 5xx from Resend shouldn't force a user to notice their
// verification email never arrived and manually hit "resend". Deliberately
// narrow: retries only network errors (fetch throwing) and 5xx responses,
// never a 4xx (bad API key, malformed request, invalid "from" address) —
// those aren't transient, and retrying them just delays the same failure
// signupUser/resend-verification's own caller already handles (log +
// generic response, account still exists, user can request a fresh link).
// Short, fixed backoff, not exponential — this runs synchronously in the
// signup/resend-verification request path, so the total added latency on
// the worst case (every attempt fails) needs to stay small, not tuned for
// squeezing out one more retry.
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;
// Without a timeout, a hung Resend call would hold the signup/resend
// request open indefinitely instead of hitting the retry/failure path
// below like a normal network error does.
const SEND_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendVerificationEmail(email: string, rawToken: string): Promise<void> {
  const verificationUrl = buildVerificationUrl(rawToken);

  if (!isEmailSendingConfigured()) {
    if (process.env.NODE_ENV === "production") {
      // A live single-use account-activation link is a credential, not
      // ordinary application data — logging it to stdout is fine for local
      // dev (only the developer's own terminal sees it) but not acceptable
      // once those logs flow to a real production log aggregator, which
      // routinely has a broader viewer list than the app itself. Fail
      // loudly instead: the caller (signup/resend-verification) already
      // treats this as a normal async failure and reports a generic error
      // to the client, so this doesn't leak anything new, it just refuses
      // to silently degrade to "print secrets in prod logs."
      throw new Error("RESEND_API_KEY is not configured; refusing to log a verification link in production.");
    }
    // Demo mode (non-production only): no real inbox to deliver to yet.
    // Logged so a developer (or this app's own test suite) can complete the
    // flow without a mailbox — never logs the email's password or any other
    // secret, only the single-use link this same request just issued.
    console.log(`[email:verification] would send to ${email}: ${verificationUrl}`);
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || "SubSentry <onboarding@resend.dev>",
          to: email,
          subject: "Verify your SubSentry email",
          html: `<p>Confirm your email to finish setting up SubSentry:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in 24 hours.</p>`,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error) {
      // Network error (DNS, connection reset, timeout) — always transient
      // enough to be worth a retry, unlike a definite HTTP response.
      lastError = error;
      if (attempt < MAX_SEND_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
      continue;
    }

    if (response.ok) return;

    if (response.status < 500) {
      // Not transient — a 4xx will fail identically on every retry
      // (bad/missing API key, malformed payload, invalid from-address).
      // Failing fast here is strictly better than burning the remaining
      // retry budget on a guaranteed-repeat failure.
      throw new Error(`Resend API request failed: ${response.status}`);
    }

    lastError = new Error(`Resend API request failed: ${response.status}`);
    if (attempt < MAX_SEND_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Resend API request failed after retries");
}
