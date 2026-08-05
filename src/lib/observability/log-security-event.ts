// Structured security-event logging — distinct from logServerError (which
// is for unexpected failures/exceptions): these are *expected* outcomes
// that are still worth a durable record for later review (a spike in
// failed_login across many emails from one IP, a lockout being hit, a
// rate limit tripping repeatedly). Same fixed-field discipline as
// logServerError: never logs a password, token, or full request body —
// only identifiers (email, IP, userId) already treated as ordinary
// application data elsewhere in this codebase's own logic.
export type SecurityEventType =
  | "login_failed"
  | "login_locked_out"
  | "login_rate_limited"
  | "signup_rate_limited"
  | "csrf_rejected"
  | "verification_rate_limited"
  | "captcha_rejected";

export function logSecurityEvent(event: SecurityEventType, meta: Record<string, string | number | undefined>): void {
  console.warn(
    JSON.stringify({
      // meta spread first, reserved fields after: every call site today
      // passes fixed keys (ip, email, path, method, origin), never one
      // named level/event/timestamp, but spreading first and letting the
      // literal fields win afterward means a future call site can never
      // accidentally (or a future attacker-influenced key can never)
      // overwrite what this log line claims its own event type/severity is.
      ...meta,
      level: "security",
      event,
      timestamp: new Date().toISOString(),
    }),
  );
}
