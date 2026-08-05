// Minimal server-side error logging — this app had none at all before this:
// every API route's catch block returned a safe, generic message to the
// client (verified — no route leaks error.message/stack), but also never
// recorded anything server-side, so a real production failure would be
// invisible. This closes that gap without opening a new one: only a fixed
// set of fields is ever logged, and `error.message` is safe to include
// because every Error thrown in this codebase describes what failed (a
// status code, a operation name), never interpolates a secret, token, or
// request body into the message string.
//
// Deliberately not a full logging library (pino/winston) — stdout
// console.error is enough for a single-process app with no log
// aggregation pipeline yet; swap the implementation here, not at each call
// site, if that changes.
export function logServerError(context: string, error: unknown, meta?: Record<string, string | number | undefined>): void {
  const message = error instanceof Error ? error.message : "non-Error thrown";
  console.error(
    JSON.stringify({
      // meta spread first, reserved fields after — same reasoning as
      // log-security-event.ts: guarantees a caller-supplied meta object can
      // never overwrite what this line claims its own level/context/message
      // are, even though every current call site already only passes safe,
      // fixed identifier keys (userId, importId, etc.).
      ...meta,
      level: "error",
      context,
      message,
      timestamp: new Date().toISOString(),
    }),
  );
}
