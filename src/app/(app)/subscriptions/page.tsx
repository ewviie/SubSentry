import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { Button } from "@/components/ui/button";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const subscriptions = await listSubscriptions(user.id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Subscriptions</h1>
        <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
          Add subscription
        </Button>
      </div>

      <SubscriptionsTable subscriptions={subscriptions} />
    </div>
  );
}
