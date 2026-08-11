import nodemailer from "nodemailer";
import { logServerError } from "@/lib/observability/log-error";

// Same "leave the config unset and the feature degrades gracefully"
// pattern as src/lib/ai/provider.ts (ANTHROPIC_API_KEY absent -> demo
// provider) and src/lib/billing/plan.ts (STRIPE_SECRET_KEY absent ->
// feature hidden): no SMTP config unset means the verification link is
// logged server-side instead of mailed — the signup/verify flow stays
// fully functional and testable without a real mailbox. Provider layer
// is Nodemailer/SMTP (previously Resend's HTTP API); buildVerificationUrl
// and the html/text template functions below are provider-agnostic and
// unchanged by that swap.
function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function buildVerificationUrl(rawToken: string): string {
  const url = new URL("/verify-email", appBaseUrl());
  url.searchParams.set("token", rawToken);
  return url.toString();
}

// support@subsentry.app is a placeholder, same convention as
// PRIVACY.md's privacy@subsentry.app — swap for a real support address
// (or a real support site URL) once one exists.
const SUPPORT_EMAIL = "support@subsentry.app";
const EMERALD = "#007a49"; // globals.css --emerald (light mode), converted to sRGB — email clients don't support oklch()

function buildVerificationEmailHtml(verificationUrl: string): string {
  const logoUrl = new URL("/logo-mark.png", appBaseUrl()).toString();
  return `
<div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:40px 32px;">
    <img src="${logoUrl}" width="32" height="32" alt="SubSentry" style="display:block;border-radius:9999px;margin-bottom:24px;" />
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#18181b;">
      Thanks for creating a SubSentry account. Verify your email address so that you can get up and running quickly.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${verificationUrl}" style="display:inline-block;background-color:${EMERALD};color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
        Verify email address
      </a>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
      Once your email has been verified, you can start setting up your account. Visit our
      <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMERALD};">support site</a>
      if you have questions or need help.
    </p>
  </div>
</div>`.trim();
}

function buildVerificationEmailText(verificationUrl: string): string {
  return [
    "Thanks for creating a SubSentry account. Verify your email address so that you can get up and running quickly.",
    "",
    `Verify email address: ${verificationUrl}`,
    "",
    `Once your email has been verified, you can start setting up your account. Visit our support site (${SUPPORT_EMAIL}) if you have questions or need help.`,
  ].join("\n");
}

function buildPasswordResetUrl(rawToken: string): string {
  const url = new URL("/reset-password", appBaseUrl());
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function buildPasswordResetEmailHtml(resetUrl: string): string {
  const logoUrl = new URL("/logo-mark.png", appBaseUrl()).toString();
  return `
<div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:40px 32px;">
    <img src="${logoUrl}" width="32" height="32" alt="SubSentry" style="display:block;border-radius:9999px;margin-bottom:24px;" />
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#18181b;">
      We received a request to reset your SubSentry password. This link expires in 1 hour and can only be used once.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${resetUrl}" style="display:inline-block;background-color:${EMERALD};color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
        Reset password
      </a>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
      If you didn't request this, you can safely ignore this email — your password won't change. Visit our
      <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMERALD};">support site</a>
      if you have questions.
    </p>
  </div>
</div>`.trim();
}

function buildPasswordResetEmailText(resetUrl: string): string {
  return [
    "We received a request to reset your SubSentry password. This link expires in 1 hour and can only be used once.",
    "",
    `Reset password: ${resetUrl}`,
    "",
    `If you didn't request this, you can safely ignore this email — your password won't change. Visit our support site (${SUPPORT_EMAIL}) if you have questions.`,
  ].join("\n");
}

export function isEmailSendingConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM,
  );
}

// Bounded retry for the SMTP send only — a transient connection blip or a
// momentary 4xx (SMTP's "temporary failure, try again") shouldn't force a
// user to notice their verification/reset email never arrived and manually
// retry. Short, fixed backoff, not exponential — this runs synchronously in
// the request path (signup/resend-verification/forgot-password), so the
// total added latency on the worst case (every attempt fails) needs to stay
// small, not tuned for squeezing out one more retry.
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;
// Without a timeout, a hung SMTP connection/greeting/send would hold the
// request open indefinitely instead of hitting the retry/failure path below
// like a normal connection error does. 15s, not 5s: observed empirically
// against smtp-mail.outlook.com — a rejected AUTH (e.g. "SmtpClientAuthentication
// is disabled for the Mailbox") can take ~5-6s to arrive, and a too-tight
// timeout means socketTimeout fires first, surfacing a generic ETIMEDOUT
// instead of the server's actual, far more actionable rejection reason.
const SEND_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
}

// Per RFC 5321, an SMTP server's reply code tells you whether a failure is
// worth retrying: 4xx is a *temporary* negative completion (server is
// asking the client to try again later — a full mailbox, a greylisting
// delay, a momentary rate limit), 5xx is *permanent* (retrying sends the
// identical request into the identical rejection). That 4xx/5xx split is
// the opposite way round from the HTTP convention the previous Resend
// implementation used here. EAUTH (bad SMTP_USER/SMTP_PASSWORD) is called
// out explicitly since a credential failure isn't guaranteed to always
// surface with a 5xx responseCode across every SMTP server implementation,
// and no amount of retrying fixes bad credentials either way.
function isRetryableSmtpError(error: SmtpError): boolean {
  if (error.code === "EAUTH") return false;
  if (typeof error.responseCode === "number") return error.responseCode < 500;
  // No SMTP response at all — a connection/DNS/timeout-level failure,
  // same "always worth a retry" reasoning the old fetch()-throw case had.
  return true;
}

interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Shared by every transactional email this app sends (verification,
// password reset) — demo-mode logging, the production-throw-if-unconfigured
// guard, and the bounded SMTP retry loop all used to live duplicated inside
// sendVerificationEmail alone; sendPasswordResetEmail below needs the exact
// same behavior, not a second copy of it. `demoLabel`/`demoValue` control
// only the one line printed in demo mode (and the word used in the
// production-throw message) — every other behavior is identical regardless
// of which email is being sent.
async function sendTransactionalEmail(email: TransactionalEmail, demoLabel: string, demoValue: string): Promise<void> {
  if (!isEmailSendingConfigured()) {
    if (process.env.NODE_ENV === "production") {
      // A live single-use link (account activation, password reset) is a
      // credential, not ordinary application data — logging it to stdout is
      // fine for local dev (only the developer's own terminal sees it) but
      // not acceptable once those logs flow to a real production log
      // aggregator, which routinely has a broader viewer list than the app
      // itself. Fail loudly instead: every caller already treats this as a
      // normal async failure and reports a generic error/no-op to the
      // client, so this doesn't leak anything new, it just refuses to
      // silently degrade to "print secrets in prod logs."
      throw new Error(`SMTP is not configured; refusing to log a ${demoLabel} link in production.`);
    }
    // Demo mode (non-production only): no real inbox to deliver to yet.
    // Logged so a developer (or this app's own test suite) can complete the
    // flow without a mailbox — never logs a password or any other secret,
    // only the single-use link this same request just issued.
    console.log(`[email:${demoLabel}] would send to ${email.to}: ${demoValue}`);
    return;
  }

  // Not cached at module scope: this app has no other long-lived
  // connection-pooled client, this is low-volume transactional mail (one
  // send per request), and a fresh transporter per call means a mid-flight
  // SMTP_* env change (or a test stubbing one) always takes effect on the
  // very next send rather than needing an explicit cache-invalidation path.
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      // A successful sendMail() only means the SMTP server *accepted* the
      // message for delivery — not proof it reached the recipient's
      // inbox (vs. e.g. their spam folder), which only the receiving
      // mailbox provider ultimately decides. messageId/accepted/rejected
      // are logged so a specific send can be traced without needing to
      // reproduce it.
      console.log(
        JSON.stringify({
          level: "info",
          context: "auth.email.smtp-sent",
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    } catch (error) {
      const smtpError = error as SmtpError;
      logServerError("auth.email.smtp-failed", error, {
        attempt,
        code: smtpError.code,
        responseCode: smtpError.responseCode,
        response: smtpError.response,
      });

      if (!isRetryableSmtpError(smtpError)) {
        throw error instanceof Error ? error : new Error("SMTP send failed");
      }

      lastError = error;
      if (attempt < MAX_SEND_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("SMTP send failed after retries");
}

export async function sendVerificationEmail(email: string, rawToken: string): Promise<void> {
  const verificationUrl = buildVerificationUrl(rawToken);
  await sendTransactionalEmail(
    {
      to: email,
      subject: "Verify your SubSentry email",
      html: buildVerificationEmailHtml(verificationUrl),
      text: buildVerificationEmailText(verificationUrl),
    },
    "verification",
    verificationUrl,
  );
}

export async function sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
  const resetUrl = buildPasswordResetUrl(rawToken);
  await sendTransactionalEmail(
    {
      to: email,
      subject: "Reset your SubSentry password",
      html: buildPasswordResetEmailHtml(resetUrl),
      text: buildPasswordResetEmailText(resetUrl),
    },
    "password-reset",
    resetUrl,
  );
}
