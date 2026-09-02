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
import { BulkQuickAddDialog } from "@/components/subscriptions/bulk-quick-add-dialog";
import { UpgradeInline } from "@/components/billing/upgrade-prompt";
import { amountStringToCents, formatCents, monthlyCents, annualCents } from "@/lib/subscriptions/money";
import type { SubscriptionInput } from "@/lib/subscriptions/validation";

// Set only for the one error /api/subscriptions/quick-add can return that
// has a real, useful next step beyond "try again" — a free-plan caller who
// just hit their daily ceiling. Everything else (parse failure, network
// error, oversized input) stays a plain error string; this is deliberately
// not a generic "any 429 gets a fancy treatment" mechanism, since the
// premium narrate-insights limiter elsewhere has its own already-adequate
// plain-text handling and doesn't need this.
interface RateLimitPrompt {
  message: string;
  beta: boolean;
  upgradeUrl: string | null;
}

type Confidence = "high" | "medium" | "low";

// Exported for bulk-quick-add-review-table.tsx, which needs the exact same
// SubscriptionInput -> SubscriptionFormValues mapping for each parsed line
// — one shared conversion rather than a second copy that could drift.
export function toFormValues(input: SubscriptionInput): SubscriptionFormValues {
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
  const [rateLimitPrompt, setRateLimitPrompt] = useState<RateLimitPrompt | null>(null);
  const [draft, setDraft] = useState<SubscriptionFormValues | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("medium");
  // Snapshotted separately from `text` (not just read live) so the summary
  // always reflects exactly what was actually sent to the parser, even in
  // the edge case where the input underneath a still-open dialog changes.
  const [parsedText, setParsedText] = useState("");
  // Local, not derived solely from the isFirstSubscription prop on each
  // call: that prop reflects the dashboard's state as of its last server
  // render, and router.refresh() (below) is async: a second add started
  // before that refresh lands would still see the pre-add `true` and show
  // the "first ever" toast twice. This flips permanently after the first
  // real showing, so the celebratory toast can only ever fire once per
  // mount regardless of how fast two adds happen back-to-back.
  const [hasShownFirstAddToast, setHasShownFirstAddToast] = useState(false);

  async function handleParse(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setRateLimitPrompt(null);
    setLoading(true);
    try {
      const res = await fetch("/api/subscriptions/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "rate_limited") {
          setRateLimitPrompt({ message: data.message, beta: Boolean(data.beta), upgradeUrl: data.upgradeUrl ?? null });
        } else {
          setError(data?.message ?? "Couldn't parse that. Try again or add it manually.");
        }
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
    // it costs monthly, reframe as yearly) but the manual/quick-add path,
    // the only guaranteed-to-happen path, since Plaid/TrueLayer/Gmail are
    // disabled and CSV/Apple both require leaving the app first, had no
    // equivalent: a silent "Subscription added" toast either way. Real
    // numbers computed from what was actually just saved, not fabricated;
    // only shown once (isFirstSubscription reflects the dashboard's state
    // *before* this add), so it reads as a genuine first-time payoff, not
    // repeated noise on every later add.
    if (isFirstSubscription && !hasShownFirstAddToast) {
      setHasShownFirstAddToast(true);
      // annualCents(...), not monthlyCents(...) * 12: this toast's own
      // yearly figure used to be computed the second way, "matching" the
      // dashboard's old (buggy) annualTotalCents — that reasoning no longer
      // holds now that every other "annual" figure in this codebase
      // (dashboard's annualTotalCents, signals.ts's findExpensiveOutliers,
      // reveal-step.tsx's totalYearlyCents) has been fixed to compute
      // directly from the stored amount instead of double-rounding through
      // a monthly-equivalent. Using annualCents here is what actually keeps
      // this toast agreeing with the dashboard the user is about to land on
      // for the exact same subscription.
      const amountCents = amountStringToCents(values.amount);
      const monthly = monthlyCents(amountCents, values.billingCycle);
      const yearly = annualCents(amountCents, values.billingCycle);
      toast.success(`${values.name} added`, {
        description: `That's ${formatCents(monthly, values.currency)}/mo, ${formatCents(yearly, values.currency)}/yr.`,
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
      {/* User Value Journey Audit, opportunity #1: this bar handled one
          subscription at a time only, the single biggest gap the audit
          found — reaching a portfolio big enough for duplicate detection,
          Health Score, or the savings/spend-trend surfaces to say anything
          real meant repeating this same type-wait-confirm loop 8-15+
          times, with no bank-export-free bulk path at all. Placed directly
          under the bar itself (not a separate page) so it's visible at the
          exact moment a new account would otherwise start that loop. */}
      <div className="mt-1.5">
        <BulkQuickAddDialog />
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {/* Section 8 of the monetization pass: a free user hitting the real
          5/day ceiling sees why (Pro's real 40/day number) and a real next
          step, not just a dead-end error — "enter it manually" (still
          works, no functionality lost) alongside the actual upgrade path. */}
      {rateLimitPrompt ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {rateLimitPrompt.message}{" "}
          <UpgradeInline
            label="Upgrade to Pro"
            beta={rateLimitPrompt.beta}
            upgradeUrl={rateLimitPrompt.upgradeUrl}
            className="align-baseline"
          />
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
