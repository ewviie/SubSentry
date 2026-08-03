"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  SubscriptionForm,
  type SubscriptionFormValues,
} from "@/components/subscriptions/subscription-form";
import type { SubscriptionInput } from "@/lib/subscriptions/validation";

type Confidence = "high" | "medium" | "low";

function toFormValues(input: SubscriptionInput): SubscriptionFormValues {
  return {
    name: input.name,
    amount: input.amount,
    currency: input.currency,
    billingCycle: input.billingCycle,
    category: input.category,
    nextRenewalDate: input.nextRenewalDate,
    status: input.status,
    notes: input.notes ?? "",
  };
}

export function QuickAddBar() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubscriptionFormValues | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("medium");

  async function handleParse(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Couldn't parse that. Try again or add it manually.");
        return;
      }
      setDraft(toFormValues(data.subscription));
      setConfidence(data.confidence ?? "medium");
    } catch {
      setError("Network error. Try again or add it manually.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(values: SubscriptionFormValues) {
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, source: "ai_parsed" }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.message ?? "Couldn't save that subscription. Try again." };
    }

    toast.success("Subscription added");
    setDraft(null);
    setText("");
    router.refresh();
    return {};
  }

  return (
    <>
      <form onSubmit={handleParse} className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ai" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Try "Netflix £10.99 monthly"'
            className="pl-9"
            maxLength={280}
            aria-label="Quick-add a subscription by typing it in plain English"
          />
        </div>
        <Button type="submit" disabled={loading || text.trim().length < 3}>
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Parsing…
            </>
          ) : (
            "Add with AI"
          )}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-ai" />
              Confirm subscription
            </DialogTitle>
            <DialogDescription>
              Review what the AI understood before saving:{" "}
              <Badge variant="secondary" className="align-middle">
                {confidence} confidence
              </Badge>
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <SubscriptionForm
              initialValues={draft}
              submitLabel="Add subscription"
              onSubmit={handleConfirm}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
