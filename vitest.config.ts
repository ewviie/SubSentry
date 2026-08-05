import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // The two DB-integration test files (queries.idor.test.ts,
    // email-verification.test.ts) each open their own connection to the
    // local PGlite dev server. Running test *files* in parallel (vitest's
    // default) gives each its own worker and its own connection — outside
    // an explicit transaction, PGlite's socket server can interleave two
    // separate connections' wire-protocol messages and corrupt the shared
    // unnamed prepared statement (the exact bug already documented and
    // fixed once in src/lib/db/index.ts for the app's own runtime
    // connection pool). Disabling file parallelism avoids re-hitting that
    // class of bug in tests; the suite is fast enough that this costs
    // negligible wall-clock time.
    fileParallelism: false,
    // e2e/**/*.spec.ts are Playwright specs (npm run test:e2e), not
    // vitest's — vitest's default include glob otherwise picks them up
    // too and fails on test.afterAll(), which only @playwright/test
    // provides.
    exclude: ["node_modules/**", "e2e/**"],
  },
});
