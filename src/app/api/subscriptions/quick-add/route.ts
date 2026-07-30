import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { quickAddSubscription } from "@/lib/ai/parse-subscription";
import { checkAndConsumeRateLimit } from "@/lib/ai/rate-limit";

// Capped well above any real "Netflix £10.99 monthly"-style input, but far
// below what would let someone stuff a large payload into the AI call.
const quickAddInputSchema = z.object({
  text: z.string().trim().min(3, "Tell me a bit more").max(280, "Keep it under 280 characters"),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = quickAddInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const rateLimit = checkAndConsumeRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "You've hit your AI usage limit for now. Try again in a few hours, or enter it manually." },
      { status: 429 },
    );
  }

  const result = await quickAddSubscription(parsed.data.text);
  if (!result.ok) {
    return NextResponse.json({ error: "parse_failed", message: result.error }, { status: 422 });
  }

  return NextResponse.json({ subscription: result.subscription, confidence: result.confidence });
}
