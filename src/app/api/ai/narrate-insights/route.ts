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

  // Non-consuming pre-check: rejects an already-exhausted caller before
  // paying for computeInsights below, which — even bounded by
  // MAX_DUPLICATE_COMPARISON_SUBSCRIPTIONS — is real, non-trivial CPU work,
  // not free. Doesn't consume a slot itself, so it can't double-charge
  // against the real check below.
  if (!(await checkNarrateInsightsRateLimit.peek(session.user.id, session.user.plan)).allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "You've hit your AI usage limit for now. Try again in a few hours." },
      { status: 429 },
    );
  }

  const subscriptions = await listSubscriptions(session.user.id);
  const insights = computeInsights(subscriptions);
  if (insights.length === 0) {
    return NextResponse.json({ narrations: [] });
  }

  // Checked (and consumed) after the empty-insights short-circuit above —
  // a call that never reaches the AI provider shouldn't cost the user any
  // of their limited daily quota. A concurrent request could in principle
  // consume the last slot between the peek above and this check; that just
  // means this request still pays for its own computeInsights call before
  // finding out it's rate-limited, same as before this change — the peek
  // only closes the "already known to be exhausted" case cheaply.
  const rateLimit = await checkNarrateInsightsRateLimit(session.user.id, session.user.plan);
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
