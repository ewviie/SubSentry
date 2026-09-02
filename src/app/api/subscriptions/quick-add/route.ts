import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { quickAddSubscription, quickAddLineSchema } from "@/lib/ai/parse-subscription";
import { checkQuickAddRateLimit, quickAddRateLimitMessage } from "@/lib/ai/rate-limit";
import { getUpgradeUrl, isBetaAllAccess } from "@/lib/billing/plan";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// The single line of text, wrapped as this route's request body — same
// bound bulk quick-add's own per-line check reuses directly (see
// quickAddLineSchema's own comment in parse-subscription.ts).
const quickAddInputSchema = z.object({
  text: quickAddLineSchema,
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = quickAddInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const rateLimit = await checkQuickAddRateLimit(session.user.id, session.user.plan);
  if (!rateLimit.allowed) {
    // Monetization pass, section 8: the free ceiling itself is unchanged
    // (FREE_QUICK_ADD_DAILY_LIMIT, still real and still enforced above,
    // regardless of what this response says) — what's new is telling the
    // caller the real Pro number right here, at the exact moment they hit
    // it, instead of a generic "try again later" with no path forward.
    // isPremium is only used to pick which limit to name in the message
    // (a real Pro caller who somehow still exhausted their own, much
    // higher ceiling shouldn't be told to upgrade to what they already
    // have) — resolveHasPaidAccess already decided which bucket
    // checkQuickAddRateLimit just checked, this just asks the same
    // question again to phrase the message correctly.
    const isPremium = await resolveHasPaidAccess(session.user.plan);
    return NextResponse.json(
      {
        error: "rate_limited",
        message: quickAddRateLimitMessage(isPremium),
        isPremium,
        beta: isBetaAllAccess(),
        upgradeUrl: isPremium ? null : getUpgradeUrl(session.user.id),
      },
      { status: 429 },
    );
  }

  const result = await quickAddSubscription(parsed.data.text);
  if (!result.ok) {
    return NextResponse.json({ error: "parse_failed", message: result.error }, { status: 422 });
  }

  return NextResponse.json({ subscription: result.subscription, confidence: result.confidence });
}
