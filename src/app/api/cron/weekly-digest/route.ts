import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/subscriptions/renewal-reminders";
import { runWeeklyDigestJob } from "@/lib/subscriptions/weekly-digest-job";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

// Same fail-closed, Bearer-token-authenticated shape as
// api/cron/renewal-reminders/route.ts — see that file's own comment for the
// full reasoning; not repeated here. verifyCronAuth is reused directly
// (it's generic, keyed off CRON_SECRET, not renewal-specific) rather than a
// second near-identical copy.
async function handleCronRequest(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  if (!verifyCronAuth(request.headers.get("authorization"))) {
    logSecurityEvent("cron_unauthorized", { path: "/api/cron/weekly-digest" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runWeeklyDigestJob();
  return NextResponse.json(result);
}

// Vercel Cron Jobs invoke via GET — see vercel.json for the weekly schedule
// this is wired to. POST is kept for manual/curl testing, same reasoning
// the renewal-reminders cron route documents on itself.
export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
