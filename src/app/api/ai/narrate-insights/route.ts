import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { computeInsights } from "@/lib/subscriptions/insights";
import { getAIProvider } from "@/lib/ai/provider";
import { checkNarrateInsightsRateLimit } from "@/lib/ai/rate-limit";
import { logServerError } from "@/lib/observability/log-error";

// Deliberately recomputes insights server-side from the session's own data
// rather than accepting them in the request body — otherwise this endpoint
// would be a free-form "narrate any text" proxy to the AI provider, well
// outside what the rate limit is meant to bound.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const subscriptions = await listSubscriptions(session.user.id);
  const insights = computeInsights(subscriptions);
  if (insights.length === 0) {
    return NextResponse.json({ narrations: [] });
  }

  // Checked after the empty-insights short-circuit above — a call that
  // never reaches the AI provider shouldn't cost the user any of their
  // limited daily quota.
  const rateLimit = checkNarrateInsightsRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "You've hit your AI usage limit for now. Try again in a few hours." },
      { status: 429 },
    );
  }

  try {
    const narrations = await getAIProvider().narrateInsights(insights);
    return NextResponse.json({ narrations });
  } catch (error) {
    logServerError("ai.narrate-insights", error, { userId: session.user.id });
    return NextResponse.json({ error: "narrate_failed", message: "Couldn't reach the AI. Try again." }, { status: 502 });
  }
}
