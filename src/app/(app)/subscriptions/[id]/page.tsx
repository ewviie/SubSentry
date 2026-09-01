import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getSubscription, listSubscriptions, getAllPriceHistoryForUser, markSubscriptionReviewed } from "@/lib/subscriptions/queries";
import { getDismissedRecommendationIds } from "@/lib/subscriptions/dismissed-recommendations";
import { subscriptionIdSchema } from "@/lib/subscriptions/validation";
import { computeInsights, computeFunctionalOverlapGroups } from "@/lib/subscriptions/insights";
import { monthlyCents, annualCents, formatCents } from "@/lib/subscriptions/money";
import { runInsightsEngine, RULE_RECOMMENDED_ACTION, mergeInsightResults } from "@/lib/insights-engine";
import { getUpgradeUrl, isBetaAllAccess } from "@/lib/billing/plan";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { EditSubscriptionForm } from "@/components/subscriptions/edit-subscription-form";
import { SubscriptionSummary } from "@/components/subscriptions/subscription-summary";
import { DuplicateNotice } from "@/components/subscriptions/duplicate-notice";
import { PriceHistoryNote } from "@/components/subscriptions/price-history-note";
import { UpgradeInline } from "@/components/billing/upgrade-prompt";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MotionCard } from "@/components/dashboard/motion-card";
import { CATEGORY_BADGE_CLASSES, CATEGORY_ICONS } from "@/lib/subscriptions/category-colors";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/subscriptions/labels";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // subscriptions.id is a Postgres uuid column. A malformed id (not
  // shaped like a UUID) makes getSubscription's query throw instead of
  // just matching zero rows. Same fix as the API route
  // (api/subscriptions/[id]/route.ts): reject the shape before querying,
  // routing straight to the same not-found page a genuinely missing id
  // already renders below, instead of an uncaught error boundary.
  if (!subscriptionIdSchema.safeParse(id).success) notFound();
  // None of these three depends on another's result: fetched in parallel
  // rather than as sequential awaits, each of which would otherwise pay a
  // full DB round-trip of latency for no reason (raised in local-council
  // review, Performance lens). getAllPriceHistoryForUser also replaces what
  // used to be a fourth, subscription-specific getPriceHistory call further
  // down this file. This subscription's own history is just one entry in
  // the same bulk-fetched map (see engine.ts/health.price_increases, the
  // other consumer this map was added for), so there's no need to fetch it
  // a second time from the same table.
  const [subscription, allSubscriptions, priceHistoryBySubscriptionId, dismissedRecommendationIds] = await Promise.all([
    getSubscription(user.id, id),
    listSubscriptions(user.id),
    getAllPriceHistoryForUser(user.id),
    getDismissedRecommendationIds(user.id),
  ]);
  if (!subscription) notFound();

  // "When did I last review it?" — see schema.ts's own comment on
  // lastReviewedAt for why this is the one deliberate write path for that
  // column: a real GET of this exact page, nowhere else. after() (not a
  // plain awaited call) so recording the view never adds latency to the
  // page the user is actually waiting on — see Next's own docs on `after`
  // for why this is the correct tool for a side effect that shouldn't block
  // the response. Scoped to userId + id together (same as every other
  // write in queries.ts), so this can never touch a row this session
  // doesn't own even if called with a stale/tampered id.
  after(() => markSubscriptionReviewed(user.id, subscription.id));

  // Same possible_overlap insight the subscriptions list already badges
  // "Possible duplicate" from (see filters.ts's getDuplicateFlaggedIds),
  // re-derived here, not a second detection mechanism, so this can never
  // flag a pairing the list itself wouldn't. Only the specific-pair variant
  // (potentialSavingsMonthlyCents set, exactly the two ids involved) counts
  // as "duplicate" here, same as the list. The broader "N subscriptions in
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
  // useful"). Every figure below is read from data this app already has,
  // no new detection runs here, only the same engine every other page
  // already calls, filtered down to whatever mentions this one
  // subscription. That keeps this page unable to disagree with the
  // dashboard/savings page about the same underlying fact.
  const active = allSubscriptions.filter((s) => s.status === "active");
  // Same-currency-as-this-subscription only: summing raw cents across
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
  // same-currency active spend at all. See SubscriptionSummary's own
  // comment on why sharePercent is nullable, not just "0%" in that case.
  const sharePercent =
    subscription.status === "active" && totalActiveAnnualCents > 0
      ? Math.round((annualCents(subscription.amountCents, subscription.billingCycle) * 100) / totalActiveAnnualCents)
      : null;

  const overlapGroup = computeFunctionalOverlapGroups(active).find((group) =>
    group.subscriptions.some((s) => s.id === subscription.id),
  );
  const relatedSubscriptions = overlapGroup ? overlapGroup.subscriptions.filter((s) => s.id !== subscription.id) : [];

  const isPremium = await resolveHasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);
  const engineOutput = runInsightsEngine(allSubscriptions, isPremium, priceHistoryBySubscriptionId, dismissedRecommendationIds);
  // positive + warnings + premiumInsights, not `optimization` separately,
  // since every optimization-category finding today is also premium (see
  // premium.ts's annual_switch_savings), so premiumInsights already covers
  // it without double-including the same finding twice. premiumInsights
  // needs no separate isPremium check here: runInsightsEngine only ever
  // evaluates PREMIUM_RULES when isPremium is true (see engine.ts), so
  // this array is already guaranteed empty for a free user. Nothing here
  // can leak a Pro-gated finding's real content onto a free user's page.
  // (Raised in local-council review, Devil's Advocate lens: a paying
  // premium user used to see strictly *less* on their own subscription's
  // detail page than the dashboard's Risk alerts card already told them
  // about the same subscription, fixed by including this array.)
  // health.price_increases excluded here specifically, same "already given
  // a fuller, more actionable treatment elsewhere on this exact page"
  // reasoning engine.ts documents for excluding health.duplicates' warning
  // branch from `results` (DuplicateNotice covers that fact above). Here,
  // PriceHistoryNote (rendered a few lines below) already shows this exact
  // subscription's own latest recorded change: same percent, same dollar
  // figure, sourced from the same computeLatestPriceChange call, the
  // instant this rule's subscriptionIds includes this subscription at all.
  // Restating it a second time inside "What SubSentry noticed" added no new
  // information (found in product council review, UX lens); unlike
  // health.duplicates the exclusion has to happen here, per-page, rather
  // than engine-wide, since Quick Wins/the health score are the *only*
  // place this fact appears on the dashboard and must keep it.
  // mergeInsightResults, not a raw [...a, ...b, ...c] concatenation: severity
  // and the premium flag are independent axes on an InsightResult, and every
  // rules/premium.ts "risk_*" rule is both critical (landing in `warnings`)
  // and premium (landing in `premiumInsights`) — concatenating directly
  // included the exact same finding twice, which is what produced a real
  // React "two children with the same key" crash here for a premium user
  // (see mergeInsightResults' own comment in engine.ts, and this page's
  // regression test in engine.test.ts).
  const relevantSignals = mergeInsightResults(engineOutput.positive, engineOutput.warnings, engineOutput.premiumInsights).filter(
    (r) => r.subscriptionIds.includes(subscription.id) && r.ruleId !== "health.price_increases",
  );
  // The first (title/description already sorted by relevance where they're
  // computed) relevant finding that has a real recommended action, never
  // manufactured for a subscription with nothing to flag.
  const recommendedAction = relevantSignals.map((r) => RULE_RECOMMENDED_ACTION[r.ruleId]).find(Boolean) ?? null;

  const priceHistory = priceHistoryBySubscriptionId.get(subscription.id) ?? [];
  const trackedSinceLabel = subscription.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const CategoryIcon = CATEGORY_ICONS[subscription.category];

  return (
    <div className="max-w-xl">
      <Link
        href="/subscriptions"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to subscriptions
      </Link>
      <MotionCard>
        <Card>
          <CardHeader>
            {/* Category icon + status/category badges: this used to be a
                bare name with no visual link back to the list it came from.
                Same icon-in-a-tinted-circle and badge treatment
                subscription-row.tsx already uses, so a subscription looks
                like the same object whether you're scanning the list or
                looking at its own page.
                CardTitle as="h1": this heading is the only one on the page
                (see card.tsx's own comment on when that override applies),
                so it needs to render as the real page title, not an h3
                nested under a heading that doesn't exist here. */}
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ${CATEGORY_BADGE_CLASSES[subscription.category]}`}
              >
                <CategoryIcon className="size-5" />
              </div>
              <div className="min-w-0">
                <CardTitle as="h1" className="truncate font-heading text-2xl">
                  {subscription.name}
                </CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className={CATEGORY_BADGE_CLASSES[subscription.category]}>
                    {CATEGORY_LABELS[subscription.category]}
                  </Badge>
                  <Badge
                    variant={
                      subscription.status === "active" ? "success" : subscription.status === "paused" ? "warning" : "outline"
                    }
                  >
                    {STATUS_LABELS[subscription.status]}
                  </Badge>
                </div>
              </div>
            </div>
            <CardDescription className="mt-1">What you&apos;re paying, and what to change.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {duplicateMatch ? <DuplicateNotice match={duplicateMatch} /> : null}
            <SubscriptionSummary subscription={subscription} history={priceHistory} sharePercent={sharePercent} />
            <PriceHistoryNote history={priceHistory} trackedSinceLabel={trackedSinceLabel} />

            {/* "What SubSentry noticed": only the pre-existing duplicate
                notice above skips this (it already gets its own, fuller
                treatment); everything else this subscription is involved in
                (concentration, expensive-outlier, renewal risk, overdue,
                uncategorized, long-running, ...) shows here as plain
                evidence, same title/description text the dashboard already
                uses for the identical finding. Silent, no section at all,
                when there's genuinely nothing to say, rather than a
                manufactured "all clear" card.

                Deliberately NOT titled "Why SubSentry flagged it" (its
                original wording). health.long_running is a real,
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

            {/* Related subscriptions: the other members of the same curated
                functional-overlap group this subscription resolves to (see
                merchant-normalizer.ts's resolveOverlapGroup), the exact same
                grouping Savings opportunities' "functional_overlap"
                recommendation is built from. Never a category-only match
                (e.g. "also software"). That's too broad a redundancy signal
                to call "related" with a straight face, same reasoning
                signals.ts's own categoryConcentration comment gives.
                Combined monthly cost and each member's own cost shown
                alongside the name: a bare list of names with no dollar
                figure was a strictly worse account of the same grouping than
                Savings opportunities already gives it (raised in
                local-council review, Devil's Advocate lens): a user clicking
                in because they suspect redundancy deserves the same "here's
                what it's actually costing" framing here, not just there. */}
            {relatedSubscriptions.length > 0 && overlapGroup ? (
              <div className="space-y-2 border-b border-border pb-4 text-sm">
                <p className="font-medium">
                  Related subscriptions:{" "}
                  <span className="font-normal text-muted-foreground">
                    {overlapGroup.label.toLowerCase()}, {formatCents(overlapGroup.combinedMonthlyCents, overlapGroup.currency)}/mo combined
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
                      <span className="shrink-0 font-financial text-xs text-muted-foreground">
                        {formatCents(monthlyCents(related.amountCents, related.billingCycle), related.currency)}/mo
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Section 11 of the monetization pass: a free caller's
                relevantSignals above can only ever be empty of premium
                content — engine.ts never evaluates PREMIUM_RULES for a
                non-premium isPremium, so there's genuinely nothing
                per-subscription to disclose here. Rather than fabricating
                "we found something about this subscription" (section 5's
                "do not fabricate opportunities" applies just as much here),
                this states the real, general fact instead: Pro adds this
                kind of analysis for every subscription, not a claim about
                this one specifically. */}
            {!isPremium ? (
              <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                Pro adds deeper cost analysis and personalized optimization tips for every subscription.{" "}
                <UpgradeInline beta={isBetaAllAccess()} upgradeUrl={upgradeUrl} />
              </p>
            ) : null}

            <EditSubscriptionForm subscription={subscription} />
          </CardContent>
        </Card>
      </MotionCard>
    </div>
  );
}
