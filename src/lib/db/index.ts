import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// A single wire-protocol Postgres connection string drives every environment
// (Neon/Supabase/Docker in prod, the local PGlite dev server in dev — see
// scripts/dev-db.ts) so there is exactly one driver and one query-builder
// type throughout the app.
function createDb(): PostgresJsDatabase<typeof schema> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. For local dev, run `npm run db:dev` in a separate " +
        "terminal (starts an embedded Postgres-compatible server) and set " +
        "DATABASE_URL=postgres://doubloon:doubloon@127.0.0.1:55432/doubloon in .env.",
    );
  }

  // prepare: false — required by the local PGlite dev server (its
  // wire-protocol implementation doesn't fully support the extended
  // query/prepared-statement protocol) and also the safe default against
  // connection poolers in transaction mode (Supabase's pooler, PgBouncer),
  // which don't support prepared statements either.
  const client = postgres(databaseUrl, { max: 5, prepare: false });
  return drizzle(client, { schema });
}

// Lazy singleton, not eager module-scope initialization: `next build`
// imports every route module to collect its metadata (even routes that end
// up fully dynamic at runtime), so a top-level `postgres(...)` call here
// would open a connection — and require DATABASE_URL — during the build
// itself, on a machine that may have no database reachable at all. The
// Proxy defers both the env check and the connection until the first actual
// query, at request time, while every existing `db.select()`/`db.insert()`/
// `db.transaction()` call site keeps working unchanged. Cached after that
// first access, same as the eager version was — one client per warm
// process/serverless instance, not one per query.
let cached: PostgresJsDatabase<typeof schema> | undefined;

export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop) {
      if (!cached) cached = createDb();
      const value = Reflect.get(cached, prop, cached);

      // $client is postgres.js's own callable client, not a method of the
      // drizzle wrapper — it's a function with begin/unsafe/end attached as
      // its own properties. bind() creates a fresh function and drops
      // those, so db.$client.end() etc. would silently stop working.
      // Nothing in this app uses $client today, but it's real, documented
      // drizzle-orm surface — return it unmodified rather than leave a trap
      // for whoever reaches for it next.
      if (prop === "$client") return value;

      // Bind everything else explicitly rather than relying on the Proxy's
      // receiver: db.select() calls the returned function with `this` set
      // to the Proxy (a bare object), not to `cached` — fine for drizzle's
      // public API today, but silently wrong the moment any internal
      // method reads a private class field (`this.#x`), since Proxies
      // never satisfy a private-field brand check for an object that isn't
      // a real class instance. Binding to the real `cached` up front makes
      // correctness independent of drizzle's implementation details.
      return typeof value === "function" ? value.bind(cached) : value;
    },
  },
);
