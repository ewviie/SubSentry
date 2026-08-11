import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSubscription, listSubscriptions } from "@/lib/subscriptions/queries";
import { subscriptionIdSchema } from "@/lib/subscriptions/validation";
import { computeInsights } from "@/lib/subscriptions/insights";
import { EditSubscriptionForm } from "@/components/subscriptions/edit-subscription-form";
import { SubscriptionSummary } from "@/components/subscriptions/subscription-summary";
import { DuplicateNotice } from "@/components/subscriptions/duplicate-notice";
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
  const subscription = await getSubscription(user.id, id);
  if (!subscription) notFound();

  // Same possible_overlap insight the subscriptions list already badges
  // "Possible duplicate" from (see filters.ts's getDuplicateFlaggedIds) —
  // re-derived here, not a second detection mechanism, so this can never
  // flag a pairing the list itself wouldn't. Only the specific-pair variant
  // (potentialSavingsMonthlyCents set, exactly the two ids involved) counts
  // as "duplicate" here, same as the list — the broader "N subscriptions in
  // this category" insight is a different, weaker signal and never shown
  // as a duplicate.
  const allSubscriptions = await listSubscriptions(user.id);
  const duplicateInsight = computeInsights(allSubscriptions).find(
    (insight) =>
      insight.type === "possible_overlap" &&
      insight.potentialSavingsMonthlyCents !== undefined &&
      insight.subscriptionIds.includes(subscription.id),
  );
  const duplicateMatch = duplicateInsight
    ? allSubscriptions.find((s) => duplicateInsight.subscriptionIds.includes(s.id) && s.id !== subscription.id)
    : undefined;

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
          <SubscriptionSummary subscription={subscription} />
          <EditSubscriptionForm subscription={subscription} />
        </CardContent>
      </Card>
    </div>
  );
}
