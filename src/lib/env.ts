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

  // Resend is configured but no real sending domain was ever set — every
  // verification email would go out from Resend's own shared sandbox
  // address (see email.ts's fallback), which has no relationship to this
  // app's own domain reputation and, on Resend's free tier, may only be
  // deliverable to the account's own verified test addresses at all. Not
  // fatal (mail can still send), but exactly the kind of "works in my
  // testing, silently fails for real users" gap this module exists to
  // surface at startup instead of on a support ticket.
  if (process.env.RESEND_API_KEY && !process.env.RESEND_FROM_EMAIL) {
    issues.push({
      variable: "RESEND_FROM_EMAIL",
      problem:
        "RESEND_API_KEY is set but RESEND_FROM_EMAIL isn't — verification emails send from Resend's shared onboarding@resend.dev sandbox address, not a domain real users will trust or that reliably delivers outside your own verified test addresses",
    });
  }

  return issues;
}
