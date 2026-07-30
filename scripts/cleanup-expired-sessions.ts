// Bulk sweep for expired session rows. lib/auth/session.ts already deletes a
// session the moment someone presents its expired token again, but a cookie
// that's simply abandoned (browser closed, device lost) never gets looked up
// again — this is what actually purges those. Intended to run on a schedule
// (daily is plenty, given the 30-day session lifetime) via whatever the
// deployment platform offers: Vercel Cron, a GitHub Actions scheduled
// workflow, plain `cron` on a self-hosted box, etc. Safe to run concurrently
// with the app or with itself — it's a single unconditional DELETE.
import { lt } from "drizzle-orm";

// Same pattern as drizzle.config.ts — this runs standalone via tsx, outside
// Next's own automatic .env loading, so DATABASE_URL needs loading explicitly.
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const { db } = await import("@/lib/db");
const { sessions } = await import("@/lib/db/schema");

// No .returning() — a cleanup run only needs the count, and materializing a
// row per deleted session would mean pulling every one of them (potentially
// hundreds of thousands, unbounded by anything in this query) into memory to
// throw them away. The postgres-js driver reports the affected-row count
// directly on the result, whether or not anything is returned.
const result = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

console.log(`Deleted ${result.count} expired session(s).`);
process.exit(0);
