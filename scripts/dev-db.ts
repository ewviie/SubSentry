// Zero-dependency local Postgres for development: an embedded PGlite instance
// exposed over the real Postgres wire protocol, so the app's single
// `postgres`-driver code path (see src/lib/db/index.ts) works identically
// against this, Docker Postgres, or a hosted Neon/Supabase database — only
// DATABASE_URL changes. Prefer `docker compose up` instead if Docker is
// available; this exists so `npm install && npm run db:dev` is enough.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const port = Number(process.env.PGLITE_PORT ?? 55432);
const dataDir = process.env.PGLITE_DATA_DIR ?? "./.pglite";
const connectionString = `postgres://doubloon:doubloon@127.0.0.1:${port}/doubloon`;

const db = new PGlite(dataDir);
// maxConnections defaults to 1, but the `postgres` driver in lib/db/index.ts
// opens a small connection pool — without headroom here, concurrent
// requests reset each other's connections.
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });

await server.start();

// A fresh PGlite cluster has no tables — apply migrations now so the
// "ready" message below is actually true, instead of failing on first
// query until someone remembers to run `npm run db:migrate` separately.
const migrationClient = postgres(connectionString, { max: 1, prepare: false });
await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
await migrationClient.end();

console.log(`Doubloon local dev database ready at ${connectionString}`);

async function shutdown() {
  await server.stop();
  await db.close();
  process.exit(0);
}

// SIGTERM too, not just SIGINT — process managers and `kill` (without -9)
// send SIGTERM by default, and skipping a graceful stop/close there risks
// leaving the .pglite data directory in a state prone to connection errors
// on the next start.
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
