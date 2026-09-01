import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/subscriptions/renewal-reminders";
import { runConnectedAccountSyncJob } from "@/lib/imports/connected-account-sync-job";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

// Watchdog phase: the automatic connected-account sync — same fail-closed,
// Bearer-token-authenticated shape as api/cron/renewal-reminders/route.ts
// and api/cron/weekly-digest/route.ts. verifyCronAuth is reused directly
// (generic, keyed off CRON_SECRET) rather than a third near-identical copy.
//
// Scheduled to run before the weekly-digest cron (see vercel.json) so a
// Monday digest can report what this sync found over the weekend — there
// is no hard dependency between the two crons (Vercel Cron Jobs don't
// support one job blocking another), only a scheduled time buffer; see
// vercel.json's own comment for the honest limitation.
async function handleCronRequest(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  if (!verifyCronAuth(request.headers.get("authorization"))) {
    logSecurityEvent("cron_unauthorized", { path: "/api/cron/sync-connected-accounts" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Aggregate counts only in the response — no user ids, no institution
  // names, no tokens. Per-account failures are already logged individually
  // (with userId/connectionId/provider, never a credential) inside
  // runConnectedAccountSyncJob itself.
  const result = await runConnectedAccountSyncJob();
  return NextResponse.json(result);
}

// Vercel Cron Jobs invoke via GET. POST is kept for manual/curl testing,
// same reasoning the other cron routes document on themselves.
export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
