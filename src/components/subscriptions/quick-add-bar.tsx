"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { QuickAddSummary } from "@/components/subscriptions/quick-add-summary";
import { amountStringToCents, formatCents, monthlyCents } from "@/lib/subscriptions/money";
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

export function QuickAddBar({ isFirstSubscription = false }: { isFirstSubscription?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SubscriptionFormValues | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("medium");
  // Snapshotted separately from `text` (not just read live) so the summary
  // always reflects exactly what was actually sent to the parser, even in
  // the edge case where the input underneath a still-open dialog changes.
  const [parsedText, setParsedText] = useState("");
  // Local, not derived solely from the isFirstSubscription prop on each
  // call: that prop reflects the dashboard's state as of its last server
  // render, and router.refresh() (below) is async — a second add started
  // before that refresh lands would still see the pre-add `true` and show
  // the "first ever" toast twice. This flips permanently after the first
  // real showing, so the celebratory toast can only ever fire once per
  // mount regardless of how fast two adds happen back-to-back.
  const [hasShownFirstAddToast, setHasShownFirstAddToast] = useState(false);

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
      setParsedText(text);
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

    // A user's genuinely first subscription is the one moment this codebase's
    // own reveal-step.tsx already proves out for imports (name it, show what
    // it costs monthly, reframe as yearly) but the manual/quick-add path —
    // the only guaranteed-to-happen path, since Plaid/TrueLayer/Gmail are
    // disabled and CSV/Apple both require leaving the app first — had no
    // equivalent: a silent "Subscription added" toast either way. Real
    // numbers computed from what was actually just saved, not fabricated;
    // only shown once (isFirstSubscription reflects the dashboard's state
    // *before* this add), so it reads as a genuine first-time payoff, not
    // repeated noise on every later add.
    if (isFirstSubscription && !hasShownFirstAddToast) {
      setHasShownFirstAddToast(true);
      // monthlyCents() * 12, not the original amount re-annualized —
      // deliberately matching every other "annual" figure this codebase
      // already computes this same way (dashboard's annualTotalCents,
      // signals.ts's findExpensiveOutliers, reveal-step.tsx's
      // totalYearlyCents): a yearly subscription's monthly-then-back-to-
      // yearly round trip can be off by a few cents from the original
      // entered amount, but computing it differently here would make this
      // toast disagree with the dashboard the user is about to land on for
      // the exact same subscription, which is worse than the existing,
      // consistent, cents-scale rounding characteristic.
      const monthly = monthlyCents(amountStringToCents(values.amount), values.billingCycle);
      toast.success(`${values.name} added`, {
        description: `That's ${formatCents(monthly, values.currency)}/mo — ${formatCents(monthly * 12, values.currency)}/yr.`,
      });
    } else {
      toast.success("Subscription added");
    }
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
              Understanding…
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
              Here&apos;s what SubSentry understood
            </DialogTitle>
            <DialogDescription>Nothing is saved until you confirm below.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <>
              <QuickAddSummary originalText={parsedText} draft={draft} confidence={confidence} />
              <SubscriptionForm
                initialValues={draft}
                submitLabel="Add subscription"
                onSubmit={handleConfirm}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
