import { NextResponse } from "next/server";
import { verifyCronAuth, runRenewalReminderJob } from "@/lib/subscriptions/renewal-reminders";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

// Internal job entry point — never anonymously triggerable. Fails closed
// (503, before touching the DB or reading the Authorization header's
// content) if CRON_SECRET isn't configured, same shape as
// api/stripe/webhook/route.ts's own fail-closed-if-secret-missing guard.
// Once configured, every request must present it as `Authorization: Bearer
// <CRON_SECRET>` (see verifyCronAuth).
async function handleCronRequest(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  if (!verifyCronAuth(request.headers.get("authorization"))) {
    // Logged (no PII — no email, no subscription/user id, this request
    // carried none we'd trust anyway) so a spike of unauthorized attempts
    // against this endpoint is visible the same way other auth failures
    // already are.
    logSecurityEvent("cron_unauthorized", { path: "/api/cron/renewal-reminders" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Aggregate counts only in the response — no subscription names, no
  // emails, no user ids. This endpoint's caller is the scheduler, not a
  // human debugging one specific reminder; per-failure detail already goes
  // to logServerError inside runRenewalReminderJob instead.
  const result = await runRenewalReminderJob();
  return NextResponse.json(result);
}

// Vercel Cron Jobs invoke the scheduled path with a GET request (and, when
// CRON_SECRET is set in the project, automatically attach it as `Authorization:
// Bearer <CRON_SECRET>` — see vercel.json for the schedule this is wired to)
// — GET is what production scheduling actually calls. POST is kept too,
// exercising the identical auth/handler path, for manual/curl testing and
// for any other scheduler that prefers POST for a state-changing action;
// nothing here treats the two differently.
export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}
