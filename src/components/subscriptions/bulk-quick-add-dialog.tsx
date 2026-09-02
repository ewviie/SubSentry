"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListPlus, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { UpgradeInline } from "@/components/billing/upgrade-prompt";
import { BulkQuickAddReviewTable } from "@/components/subscriptions/bulk-quick-add-review-table";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";
import type { BulkQuickAddLineResult } from "@/lib/ai/bulk-quick-add";

type Step = "paste" | "review";

interface RateLimitPrompt {
  message: string;
  beta: boolean;
  upgradeUrl: string | null;
}

const PLACEHOLDER = 'Netflix $15.99/mo\nSpotify $9.99/mo\niCloud $2.99/mo';

// User Value Journey Audit, opportunity #1: the single quick-add bar
// (quick-add-bar.tsx) is the only guaranteed-frictionless way to add a
// subscription in this deployment (CSV/Apple both need a file from outside
// the app first; Plaid/TrueLayer/Gmail are disabled here — see that
// component's own comment), but it only ever handles one line at a time.
// This is the same flow, extended to a pasted list: parse (this dialog's
// "paste" step, via /api/subscriptions/quick-add/bulk) -> review each line,
// edit or remove any of them (BulkQuickAddReviewTable) -> confirm, which
// commits through createSubscriptionsBulkWithLimitCheck exactly like a CSV
// import confirm does (/api/subscriptions/quick-add/bulk/confirm). Nothing
// is saved before that last step. Free and Pro reach every step of this
// identically — the only gate anywhere in this flow is the same per-line
// AI-quota check a single quick-add already applies, never a paywall on
// the flow itself.
export function BulkQuickAddDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitPrompt, setRateLimitPrompt] = useState<RateLimitPrompt | null>(null);
  const [results, setResults] = useState<BulkQuickAddLineResult[]>([]);
  const [omittedLineCount, setOmittedLineCount] = useState(0);

  function reset() {
    setStep("paste");
    setText("");
    setError(null);
    setRateLimitPrompt(null);
    setResults([]);
    setOmittedLineCount(0);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  }

  async function handleParse() {
    setError(null);
    setRateLimitPrompt(null);
    setParsing(true);
    try {
      const res = await fetch("/api/subscriptions/quick-add/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "rate_limited") {
          setRateLimitPrompt({ message: data.message, beta: false, upgradeUrl: null });
        } else {
          setError(data?.message ?? "Couldn't parse that. Try again.");
        }
        return;
      }
      setResults(data.results ?? []);
      setOmittedLineCount(data.omittedLineCount ?? 0);
      setStep("review");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm(rows: SubscriptionFormValues[]) {
    setConfirming(true);
    try {
      const res = await fetch("/api/subscriptions/quick-add/bulk/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.message ?? "Couldn't add those subscriptions. Try again.");
        return;
      }
      const count = data.subscriptions?.length ?? rows.length;
      toast.success(count === 1 ? "1 subscription added" : `${count} subscriptions added`);
      handleOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="text-muted-foreground" />}>
        <ListPlus className="size-3.5" aria-hidden="true" />
        Add multiple at once
      </DialogTrigger>
      <DialogContent className={step === "review" ? "sm:max-w-3xl" : "sm:max-w-lg"}>
        {step === "paste" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-ai" />
                Add multiple subscriptions
              </DialogTitle>
              <DialogDescription>
                Paste one subscription per line. Nothing is saved until you review and confirm them.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={6}
              maxLength={6000}
              aria-label="Paste a list of subscriptions, one per line"
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {rateLimitPrompt ? (
              <p role="alert" className="text-sm text-muted-foreground">
                {rateLimitPrompt.message}{" "}
                <UpgradeInline label="Upgrade to Pro" beta={rateLimitPrompt.beta} upgradeUrl={rateLimitPrompt.upgradeUrl} className="align-baseline" />
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={handleParse} disabled={parsing || text.trim().length < 3}>
                {parsing ? (
                  <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Understanding…
                  </>
                ) : (
                  "Parse list"
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review before adding</DialogTitle>
              <DialogDescription>Edit or remove any row — nothing is saved until you confirm.</DialogDescription>
            </DialogHeader>
            <BulkQuickAddReviewTable
              results={results}
              omittedLineCount={omittedLineCount}
              busy={confirming}
              onConfirm={handleConfirm}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
