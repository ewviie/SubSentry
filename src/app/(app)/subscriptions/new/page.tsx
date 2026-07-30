"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SubscriptionForm, type SubscriptionFormValues } from "@/components/subscriptions/subscription-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewSubscriptionPage() {
  const router = useRouter();

  async function handleSubmit(values: SubscriptionFormValues) {
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.message ?? "Couldn't save that subscription. Try again." };
    }

    toast.success("Subscription added");
    router.push("/dashboard");
    router.refresh();
    return {};
  }

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl">Add a subscription</CardTitle>
          <CardDescription>
            Enter the details manually, or use the quick-add bar on your dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubscriptionForm submitLabel="Add subscription" onSubmit={handleSubmit} />
        </CardContent>
      </Card>
    </div>
  );
}
