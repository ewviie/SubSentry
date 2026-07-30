import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env");
} catch (error) {
  // Only a missing .env is fine (DATABASE_URL might be set another way) —
  // a malformed or unreadable file should surface loudly here rather than
  // silently falling through to an unset or stale inherited DATABASE_URL.
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and set it.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
