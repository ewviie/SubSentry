import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { dismissRecommendation } from "@/lib/subscriptions/dismissed-recommendations";
import { checkSubscriptionMutateRateLimit } from "@/lib/subscriptions/rate-limit";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// recommendationId is computeSavingsRecommendations' own generated string
// (e.g. "duplicate-<uuid>-<uuid>"), not a database id — no ownership check
// against a live recommendation is needed or possible here (this route
// never reads the subscriptions table at all). Storing an id that doesn't
// match anything real is harmless: it just sits unused in this user's own
// dismissed-list row and never matches a real recommendation.id to filter
// against on a later /savings render. Reuses subscriptions' own mutate
// rate limit rather than a new one — a dismiss is the same class of
// frequent, low-stakes, per-user write those limits already exist for.
const dismissSchema = z.object({
  recommendationId: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkSubscriptionMutateRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many changes recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = dismissSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  await dismissRecommendation(session.user.id, parsed.data.recommendationId);
  return NextResponse.json({ ok: true });
}
