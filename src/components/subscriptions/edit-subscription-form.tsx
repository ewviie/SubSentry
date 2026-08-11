"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  SubscriptionForm,
  subscriptionToFormValues,
  type SubscriptionFormValues,
} from "@/components/subscriptions/subscription-form";
import { amountStringToCents, formatCents, monthlyCents } from "@/lib/subscriptions/money";
import type { Subscription } from "@/lib/db/schema";

export function EditSubscriptionForm({ subscription }: { subscription: Subscription }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(values: SubscriptionFormValues) {
    const res = await fetch(`/api/subscriptions/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.message ?? "Couldn't save your changes. Try again." };
    }

    // Financial-consequence feedback, gated strictly to a genuine
    // active-to-canceled transition — not paused (suspended, not actually
    // saved yet) and not any other edit. A subscription's own already-
    // persisted amount/currency/billingCycle at the moment of *this* save
    // is unambiguous here, unlike the delete flow below where the same
    // action could just as easily be correcting a duplicate/data-entry
    // mistake rather than a real cancellation — see handleDelete's own
    // comment for why that one stays a neutral toast.
    if (subscription.status === "active" && values.status === "canceled") {
      const monthly = monthlyCents(amountStringToCents(values.amount), values.billingCycle);
      toast.success("Canceled", {
        description: `You'll save ${formatCents(monthly, values.currency)}/mo.`,
      });
    } else {
      toast.success("Changes saved");
    }
    router.push("/dashboard");
    router.refresh();
    return {};
  }

  // Deliberately no "you'll save $X/mo" framing here, unlike the
  // active→canceled case above — a delete is genuinely ambiguous about
  // whether real-world spend actually changed (it could just as easily be
  // removing a duplicate row or fixing a data-entry mistake as ending a
  // real subscription), and claiming a saving that may not be true would
  // violate this app's own "never fabricate a number" rule. "Subscription
  // deleted" states only what actually happened.
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete that subscription. Try again.");
        return;
      }
      toast.success("Subscription deleted");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Couldn't delete that subscription. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <SubscriptionForm
        initialValues={subscriptionToFormValues(subscription)}
        showStatus
        submitLabel="Save changes"
        onSubmit={handleSubmit}
      />
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <p className="text-sm font-medium">Danger zone</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleting a subscription removes it and its history permanently.
        </p>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" className="mt-3" />}>
            Delete subscription
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {subscription.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes it and its history permanently. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Deleting…
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
