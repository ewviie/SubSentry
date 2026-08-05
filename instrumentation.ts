// Runs once per server instance start (Next.js's stable instrumentation
// hook — not per-request, not during `next build`'s module collection).
// Gated on NEXT_RUNTIME === "nodejs" so this never runs on the Edge
// runtime or during build-time static analysis, matching the same
// build-vs-runtime distinction src/lib/db/index.ts's lazy connection Proxy
// already relies on.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("@/lib/env");
  const issues = validateEnv();
  for (const issue of issues) {
    console.error(JSON.stringify({ level: "error", context: "env.validate", ...issue }));
  }
}
