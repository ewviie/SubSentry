import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dismissedSavingsRecommendations } from "@/lib/db/schema";

// Every id computeSavingsRecommendations (savings.ts) has ever produced for
// this user, dismissed or not, that this user has since dismissed on
// /savings. A plain Set: callers just need `.has(recommendation.id)`, not
// the dismissedAt timestamps this table also stores (nothing in the
// product surfaces "you dismissed this 3 days ago" today, so there's
// nothing here to build for that yet).
export async function getDismissedRecommendationIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ recommendationId: dismissedSavingsRecommendations.recommendationId })
    .from(dismissedSavingsRecommendations)
    .where(eq(dismissedSavingsRecommendations.userId, userId));
  return new Set(rows.map((r) => r.recommendationId));
}

// onConflictDoNothing on the (userId, recommendationId) unique index: the
// same recommendation id is deterministic and stable across renders (see
// schema.ts's own comment), so a double-dismiss — a slow network retry, or
// the same finding reappearing after being briefly resolved and then
// recurring — is a harmless no-op, never a duplicate row or a thrown
// constraint-violation error the API route would otherwise have to catch.
export async function dismissRecommendation(userId: string, recommendationId: string): Promise<void> {
  await db
    .insert(dismissedSavingsRecommendations)
    .values({ userId, recommendationId })
    .onConflictDoNothing();
}
