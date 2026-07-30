"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SubscriptionForm,
  subscriptionToFormValues,
  type SubscriptionFormValues,
} from "@/components/subscriptions/subscription-form";
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

    toast.success("Changes saved");
    router.push("/dashboard");
    router.refresh();
    return {};
  }

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
        <Button variant="destructive" className="mt-3" onClick={handleDelete} disabled={deleting}>
          {deleting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Deleting…
            </>
          ) : (
            "Delete subscription"
          )}
        </Button>
      </div>
    </div>
  );
}
