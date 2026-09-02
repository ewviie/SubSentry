import type { NotificationSeverity } from "./types";

// The one priority order this app uses to decide "what matters most" among
// a set of notifications — warning before info, then real dollar impact.
// Previously defined independently in two places (digest.ts's own
// topPriorityNotification selection, notifications/queries.ts's own
// getAttentionItems ranking) as two byte-for-byte-identical copies that
// could silently drift apart — the exact "two copies of the same rule"
// risk this codebase's own namesLikelyMatch extraction comment (insights.ts)
// already warns about elsewhere. Both now import this one export instead.
export const SEVERITY_RANK: Record<NotificationSeverity, number> = { warning: 1, info: 0 };

// Anything with a severity and a nullable dollar impact can be ranked this
// way — real DB `Notification` rows, or a plain in-memory
// NotificationCandidate (generate.ts), or the change-summary items below.
export interface PriorityRankable {
  severity: NotificationSeverity;
  impactCents: number | null;
}

export function comparePriority(a: PriorityRankable, b: PriorityRankable): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.impactCents ?? 0) - (a.impactCents ?? 0);
}

export interface ChangeHighlight {
  title: string;
  body: string;
}

// The single most-worth-mentioning item, plus (new) a second one when a
// real second candidate exists — used identically by the weekly digest
// (computeWeeklyDigestSummary) and the dashboard's "Needs your attention"
// panel (AttentionPanel), so "what's the top 1-2 things that changed" can
// never disagree between the two surfaces the way two independently
// re-derived selections could. Deterministic, template-composed by the
// callers that render this — this function only ever picks and ranks real,
// already-produced title/body pairs, it never generates prose.
//
// Pure and synchronous: sorts a copy (never mutates the caller's array),
// same defensive posture every other array-returning function in this
// codebase already follows (see savings.ts's own comment on why
// computeSavingsRecommendations always spreads before sorting).
export function summarizeTopChanges<T extends PriorityRankable & ChangeHighlight>(
  candidates: T[],
): { title: string; body: string; secondary: ChangeHighlight | null } | null {
  if (candidates.length === 0) return null;
  const [first, second] = [...candidates].sort(comparePriority);
  return {
    title: first.title,
    body: first.body,
    secondary: second ? { title: second.title, body: second.body } : null,
  };
}
