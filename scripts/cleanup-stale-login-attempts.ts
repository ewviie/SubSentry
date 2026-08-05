export {}; // makes this a module so top-level await is allowed (see below)

// Bulk sweep for stale login_attempts rows. lockout.ts tracks one row per
// email that has ever failed a login and never deletes it on its own (a
// clean login resets counters to zero but leaves the row) — this purges
// rows old enough that they're no longer a meaningful security signal.
// Intended to run on the same schedule as cleanup-expired-sessions.ts (see
// that file for deployment options: Vercel Cron, a GitHub Actions scheduled
// workflow, plain cron, etc.).

// Same pattern as drizzle.config.ts / cleanup-expired-sessions.ts — this
// runs standalone via tsx, outside Next's own automatic .env loading, so
// DATABASE_URL needs loading explicitly before anything that touches the DB
// is imported.
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const { deleteStaleLoginAttempts } = await import("@/lib/auth/lockout");

await deleteStaleLoginAttempts();
console.log("Deleted stale login_attempts row(s) older than 30 days.");
process.exit(0);
