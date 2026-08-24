import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSubscription, listSubscriptions, getPriceHistory } from "@/lib/subscriptions/queries";
import { subscriptionIdSchema } from "@/lib/subscriptions/validation";
import { computeInsights, computeFunctionalOverlapGroups } from "@/lib/subscriptions/insights";
import { monthlyCents, annualCents, formatCents } from "@/lib/subscriptions/money";
import { runInsightsEngine, RULE_RECOMMENDED_ACTION } from "@/lib/insights-engine";
import { hasPaidAccess } from "@/lib/billing/plan";
import { EditSubscriptionForm } from "@/components/subscriptions/edit-subscription-form";
import { SubscriptionSummary } from "@/components/subscriptions/subscription-summary";
import { DuplicateNotice } from "@/components/subscriptions/duplicate-notice";
import { PriceHistoryNote } from "@/components/subscriptions/price-history-note";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // subscriptions.id is a Postgres uuid column — a malformed id (not
  // shaped like a UUID) makes getSubscription's query throw instead of
  // just matching zero rows. Same fix as the API route
  // (api/subscriptions/[id]/route.ts): reject the shape before querying,
  // routing straight to the same not-found page a genuinely missing id
  // already renders below, instead of an uncaught error boundary.
  if (!subscriptionIdSchema.safeParse(id).success) notFound();
  // Neither read depends on the other's result — sequential awaits here
  // paid one full DB round-trip of latency on every single page load for
  // no reason (raised in local-council review, Performance lens).
  // getPriceHistory below still awaits separately: it genuinely needs
  // subscription.id, which only exists once this resolves.
  const [subscription, allSubscriptions] = await Promise.all([
    getSubscription(user.id, id),
    listSubscriptions(user.id),
  ]);
  if (!subscription) notFound();

  // Same possible_overlap insight the subscriptions list already badges
  // "Possible duplicate" from (see filters.ts's getDuplicateFlaggedIds) —
  // re-derived here, not a second detection mechanism, so this can never
  // flag a pairing the list itself wouldn't. Only the specific-pair variant
  // (potentialSavingsMonthlyCents set, exactly the two ids involved) counts
  // as "duplicate" here, same as the list — the broader "N subscriptions in
  // this category" insight is a different, weaker signal and never shown
  // as a duplicate.
  const duplicateInsight = computeInsights(allSubscriptions).find(
    (insight) =>
      insight.type === "possible_overlap" &&
      insight.potentialSavingsMonthlyCents !== undefined &&
      insight.subscriptionIds.includes(subscription.id),
  );
  const duplicateMatch = duplicateInsight
    ? allSubscriptions.find((s) => duplicateInsight.subscriptionIds.includes(s.id) && s.id !== subscription.id)
    : undefined;

  // Phase 9, Part 17 ("make each subscription detail page genuinely
  // useful"). Every figure below is read from data this app already has —
  // no new detection runs here, only the same engine every other page
  // already calls, filtered down to whatever mentions this one
  // subscription. That keeps this page unable to disagree with the
  // dashboard/savings page about the same underlying fact.
  const active = allSubscriptions.filter((s) => s.status === "active");
  // Same-currency-as-this-subscription only — summing raw cents across
  // currencies would produce a meaningless denominator (the exact rule
  // computeRealizedSavings/computeFunctionalOverlapGroups already enforce
  // elsewhere; caught in CodeRabbit review, this call site had been
  // missed). A user whose active spend genuinely spans currencies gets a
  // share of *this subscription's own currency's* spend, not a fabricated
  // cross-currency percentage.
  const sameCurrencyActive = active.filter((s) => s.currency === subscription.currency);
  // Not monthlyCents(...) summed then * 12 — see money.ts's own annualCents
  // comment for why that double-rounds every yearly/quarterly/weekly
  // subscription's annual figure away from its own stored price. Each
  // subscription's exact annual figure is summed directly instead (same
  // pattern as signals.ts's annualTotalCents).
  const totalActiveAnnualCents = sameCurrencyActive.reduce((sum, s) => sum + annualCents(s.amountCents, s.billingCycle), 0);
  // null (not 0) for a paused/canceled subscription, or a portfolio with no
  // same-currency active spend at all — see SubscriptionSummary's own
  // comment on why sharePercent is nullable, not just "0%" in that case.
  const sharePercent =
    subscription.status === "active" && totalActiveAnnualCents > 0
      ? Math.round((annualCents(subscription.amountCents, subscription.billingCycle) * 100) / totalActiveAnnualCents)
      : null;

  const overlapGroup = computeFunctionalOverlapGroups(active).find((group) =>
    group.subscriptions.some((s) => s.id === subscription.id),
  );
  const relatedSubscriptions = overlapGroup ? overlapGroup.subscriptions.filter((s) => s.id !== subscription.id) : [];

  const isPremium = hasPaidAccess(user.plan);
  const engineOutput = runInsightsEngine(allSubscriptions, isPremium);
  // positive + warnings + premiumInsights — not `optimization` separately,
  // since every optimization-category finding today is also premium (see
  // premium.ts's annual_switch_savings), so premiumInsights already covers
  // it without double-including the same finding twice. premiumInsights
  // needs no separate isPremium check here: runInsightsEngine only ever
  // evaluates PREMIUM_RULES when isPremium is true (see engine.ts), so
  // this array is already guaranteed empty for a free user — nothing here
  // can leak a Pro-gated finding's real content onto a free user's page.
  // (Raised in local-council review, Devil's Advocate lens: a paying
  // premium user used to see strictly *less* on their own subscription's
  // detail page than the dashboard's Risk alerts card already told them
  // about the same subscription — fixed by including this array.)
  const relevantSignals = [...engineOutput.positive, ...engineOutput.warnings, ...engineOutput.premiumInsights].filter(
    (r) => r.subscriptionIds.includes(subscription.id),
  );
  // The first (title/description already sorted by relevance where they're
  // computed) relevant finding that has a real recommended action — never
  // manufactured for a subscription with nothing to flag.
  const recommendedAction = relevantSignals.map((r) => RULE_RECOMMENDED_ACTION[r.ruleId]).find(Boolean) ?? null;

  const priceHistory = await getPriceHistory(user.id, subscription.id);
  const trackedSinceLabel = subscription.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="max-w-xl">
      <Link
        href="/subscriptions"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to subscriptions
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl">{subscription.name}</CardTitle>
          <CardDescription>What you&apos;re paying, and what to change.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {duplicateMatch ? <DuplicateNotice match={duplicateMatch} /> : null}
          <SubscriptionSummary subscription={subscription} history={priceHistory} sharePercent={sharePercent} />
          <PriceHistoryNote history={priceHistory} trackedSinceLabel={trackedSinceLabel} />

          {/* "What SubSentry noticed" — only the pre-existing duplicate
              notice above skips this (it already gets its own, fuller
              treatment); everything else this subscription is involved in
              (concentration, expensive-outlier, renewal risk, overdue,
              uncategorized, long-running, ...) shows here as plain
              evidence, same title/description text the dashboard already
              uses for the identical finding. Silent — no section at all —
              when there's genuinely nothing to say, rather than a
              manufactured "all clear" card.

              Deliberately NOT titled "Why SubSentry flagged it" (its
              original wording) — health.long_running is a real,
              intentional exception with `severity: "positive"` and real
              subscriptionIds (see rules/health.ts), so a subscription
              whose *only* relevant finding is "kept over a year, stable
              spend" used to be introduced under an accusatory heading for
              good news (raised in local-council review, Compliance
              lens). Each line's own color now carries the same positive/
              negative distinction the dashboard's health-dimension dots
              already use elsewhere, on top of text that's unambiguous on
              its own either way. */}
          {relevantSignals.length > 0 ? (
            <div className="space-y-2 border-b border-border pb-4 text-sm">
              <p className="font-medium">What SubSentry noticed</p>
              <ul className="space-y-1.5 text-muted-foreground">
                {relevantSignals.map((signal) => (
                  <li key={signal.ruleId}>
                    <span className={signal.severity === "positive" ? "text-emerald" : "text-foreground"}>
                      {signal.title}.
                    </span>{" "}
                    {signal.description}
                  </li>
                ))}
              </ul>
              {recommendedAction ? (
                <p className="pt-1 text-foreground">
                  <span className="font-medium">Recommended:</span> {recommendedAction}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Related subscriptions — the other members of the same curated
              functional-overlap group this subscription resolves to (see
              merchant-normalizer.ts's resolveOverlapGroup), the exact same
              grouping Savings opportunities' "functional_overlap"
              recommendation is built from. Never a category-only match
              (e.g. "also software") — that's too broad a redundancy signal
              to call "related" with a straight face, same reasoning
              signals.ts's own categoryConcentration comment gives.
              Combined monthly cost and each member's own cost shown
              alongside the name — a bare list of names with no dollar
              figure was a strictly worse account of the same grouping than
              Savings opportunities already gives it (raised in
              local-council review, Devil's Advocate lens): a user clicking
              in because they suspect redundancy deserves the same "here's
              what it's actually costing" framing here, not just there. */}
          {relatedSubscriptions.length > 0 && overlapGroup ? (
            <div className="space-y-2 border-b border-border pb-4 text-sm">
              <p className="font-medium">
                Related subscriptions{" "}
                <span className="font-normal text-muted-foreground">
                  — {overlapGroup.label.toLowerCase()}, {formatCents(overlapGroup.combinedMonthlyCents, overlapGroup.currency)}/mo combined
                </span>
              </p>
              <ul className="space-y-1">
                {relatedSubscriptions.map((related) => (
                  <li key={related.id} className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/subscriptions/${related.id}`}
                      className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                    >
                      {related.name}
                    </Link>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatCents(monthlyCents(related.amountCents, related.billingCycle), related.currency)}/mo
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <EditSubscriptionForm subscription={subscription} />
        </CardContent>
      </Card>
    </div>
  );
}
