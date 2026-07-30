import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// A single wire-protocol Postgres connection string drives every environment
// (Neon/Supabase/Docker in prod, the local PGlite dev server in dev — see
// scripts/dev-db.ts) so there is exactly one driver and one query-builder
// type throughout the app.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. For local dev, run `npm run db:dev` in a separate " +
      "terminal (starts an embedded Postgres-compatible server) and set " +
      "DATABASE_URL=postgres://doubloon:doubloon@127.0.0.1:55432/doubloon in .env.",
  );
}

// prepare: false — required by the local PGlite dev server (its wire-protocol
// implementation doesn't fully support the extended query/prepared-statement
// protocol) and also the safe default against connection poolers in
// transaction mode (Supabase's pooler, PgBouncer), which don't support
// prepared statements either.
const client = postgres(databaseUrl, { max: 5, prepare: false });
export const db = drizzle(client, { schema });
