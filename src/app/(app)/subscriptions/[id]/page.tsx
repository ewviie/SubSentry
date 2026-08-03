import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSubscription } from "@/lib/subscriptions/queries";
import { EditSubscriptionForm } from "@/components/subscriptions/edit-subscription-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const subscription = await getSubscription(user.id, id);
  if (!subscription) notFound();

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
          <CardDescription>Edit this subscription.</CardDescription>
        </CardHeader>
        <CardContent>
          <EditSubscriptionForm subscription={subscription} />
        </CardContent>
      </Card>
    </div>
  );
}
