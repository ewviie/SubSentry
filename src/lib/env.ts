// Single place documenting every env var this app reads, and validating
// the ones with a fixed shape. Deliberately does NOT throw — every
// individual feature already has its own `isXConfigured()` gate (Plaid,
// TrueLayer, Stripe, AI, email — see src/lib/{imports,billing,ai,auth}/*)
// that degrades gracefully when its var is absent; this module's job is
// only to surface a clear, structured warning for a *misconfigured* var
// (present but malformed, or half of a required pair) so a bad deploy is
// visible in logs at startup instead of failing confusingly on the first
// request that happens to need it. See instrumentation.ts for where this
// runs once per server start.
import { isEmailSendingConfigured } from "./auth/email";
import { getAppUrl } from "./seo";

export interface EnvIssue {
  variable: string;
  problem: string;
}

function isValidPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isValidBase64Key32Bytes(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

export function validateEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];

  // The one genuinely required var — every request touches the DB. Not a
  // hard `throw` here (see file header), but the clearest possible signal
  // this deploy is broken.
  if (!process.env.DATABASE_URL) {
    issues.push({ variable: "DATABASE_URL", problem: "not set — no request that touches the database can succeed" });
  } else if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    issues.push({ variable: "DATABASE_URL", problem: "set but not a valid postgres:// / postgresql:// URL" });
  }

  if (process.env.TOKEN_ENCRYPTION_KEY && !isValidBase64Key32Bytes(process.env.TOKEN_ENCRYPTION_KEY)) {
    issues.push({
      variable: "TOKEN_ENCRYPTION_KEY",
      problem: "set but does not decode to exactly 32 bytes of base64 — bank-connection token encryption will fail at first use",
    });
  }

  // Pairs where the app treats "half set" as fully disabled (see each
  // isXConfigured()) — not wrong, but worth flagging as likely a typo
  // rather than a deliberate choice, since "half enabled" almost always
  // means someone meant to configure it.
  const pairs: [string, string, string, string][] = [
    ["PLAID_CLIENT_ID", "PLAID_SECRET", "Plaid", "Plaid import stays disabled"],
    ["TRUELAYER_CLIENT_ID", "TRUELAYER_CLIENT_SECRET", "TrueLayer", "TrueLayer import stays disabled"],
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "Google", "Gmail import stays disabled"],
    [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "Upstash",
      "distributed rate limiting falls back to this process's own in-memory limiter",
    ],
    [
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "Turnstile",
      "CAPTCHA verification stays disabled on signup/resend-verification (server-side check is skipped entirely, not just cosmetically hidden)",
    ],
  ];
  for (const [a, b, label, consequence] of pairs) {
    const hasA = Boolean(process.env[a]);
    const hasB = Boolean(process.env[b]);
    if (hasA !== hasB) {
      issues.push({
        variable: hasA ? b : a,
        problem: `${label} is half-configured (only ${hasA ? a : b} is set) — ${consequence} until both are set`,
      });
    }
  }

  if (process.env.STRIPE_PAYMENT_LINK && !process.env.STRIPE_WEBHOOK_SECRET) {
    issues.push({
      variable: "STRIPE_WEBHOOK_SECRET",
      problem: "STRIPE_PAYMENT_LINK is set but STRIPE_WEBHOOK_SECRET isn't — checkouts can start but will never be confirmed",
    });
  }

  // Email sending (Nodemailer/SMTP — see auth/email.ts) is all-or-nothing:
  // isEmailSendingConfigured() there requires every one of these five, so
  // any subset being set is always a typo/incomplete-setup, never a
  // deliberate partial configuration — the feature stays fully disabled
  // (silently falling back to demo-mode console logging, or throwing in
  // production) until all five are present.
  const smtpVars = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
  const smtpSet = smtpVars.filter((v) => Boolean(process.env[v]));
  if (smtpSet.length > 0 && smtpSet.length < smtpVars.length) {
    const missing = smtpVars.filter((v) => !smtpSet.includes(v));
    issues.push({
      variable: missing[0],
      problem: `SMTP is partially configured (missing ${missing.join(", ")}) — verification emails stay undeliverable until all of ${smtpVars.join(", ")} are set`,
    });
  } else if (process.env.SMTP_PORT && !Number.isInteger(Number(process.env.SMTP_PORT))) {
    issues.push({
      variable: "SMTP_PORT",
      problem: `set to "${process.env.SMTP_PORT}", which is not a valid port number`,
    });
  }

  // NEXT_PUBLIC_APP_URL has no dedicated isXConfigured() gate of its own —
  // every *other* place that reads it (metadataBase, sitemap.ts, robots.ts,
  // the structured-data `url` field) goes through lib/seo.ts's getAppUrl(),
  // which already treats "unset" *or* "malformed" as "omit this field"
  // rather than fabricating a URL against localhost or throwing, exactly to
  // avoid shipping something broken (see that file's own comment on the
  // convention). auth/email.ts's appBaseUrl() is the one place that can't
  // follow that convention the same way — a verification/reset email link
  // has to point *somewhere* — so it falls back to
  // "http://localhost:3000" instead. That fallback is correct for local
  // dev, where SMTP is normally unconfigured too and the link only ever
  // gets logged to a developer's own terminal — but if SMTP *is*
  // configured (a real send will actually happen) and this is still
  // unset, every verification/password-reset email a real user receives
  // would contain a dead localhost link with no way to complete either
  // flow. That combination is what the first branch below flags, not
  // NEXT_PUBLIC_APP_URL being unset on its own (which is a normal, safe
  // "not deployed yet" state everywhere else in the app).
  //
  // The second branch below is a distinct problem: the var *is* set but
  // isn't a well-formed absolute http(s) URL (missing scheme, a typo'd
  // protocol, etc.). getAppUrl() degrades that gracefully at render time
  // (treats it as unset rather than letting `new URL()` throw and crash
  // metadata generation site-wide) — but silently falling back everywhere
  // is exactly the kind of misconfiguration this module exists to surface
  // loudly instead of leaving to be noticed later as "why do all my pages
  // have relative canonical URLs / no sitemap link."
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (rawAppUrl && !getAppUrl()) {
    issues.push({
      variable: "NEXT_PUBLIC_APP_URL",
      problem: `set to "${rawAppUrl}", which is not a valid absolute http(s) URL — canonical links, sitemap entries, and OG/Twitter image URLs will silently fall back to relative paths instead of using it`,
    });
  } else if (!rawAppUrl && isEmailSendingConfigured()) {
    issues.push({
      variable: "NEXT_PUBLIC_APP_URL",
      problem:
        "not set, but SMTP is fully configured — every verification/password-reset email sent from here will link to http://localhost:3000 instead of the real app",
    });
  }

  return issues;
}
