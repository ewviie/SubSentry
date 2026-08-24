"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { amountStringToCents, formatCents, annualCents } from "@/lib/subscriptions/money";
import { fadeInUp, staggerContainer } from "@/lib/motion";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

// The gap this closes: the confirm dialog used to jump straight to a bare
// edit form with no visible connection back to what was typed — "confirm
// subscription" over a generic form doesn't communicate that anything was
// understood, just that a form exists. This states what was actually
// extracted, in the exact words a person would use to check it themselves
// ("Netflix, $15.99/mo, streaming, ~$191.88/year"), before the editable
// fields below it. Nothing here is invented: every value comes straight
// from the same parsed draft the form renders, just read aloud once first.
export function QuickAddSummary({
  originalText,
  draft,
  confidence,
}: {
  originalText: string;
  draft: SubscriptionFormValues;
  confidence: "high" | "medium" | "low";
}) {
  const prefersReducedMotion = useReducedMotion();
  const dateProvided = draft.nextRenewalDate !== "";
  const amountCents = amountStringToCents(draft.amount);
  // Not monthlyCents(...) * 12 — see money.ts's own annualCents comment for
  // why that double-rounds a yearly/quarterly/weekly amount away from what
  // was actually typed.
  const yearlyCents = annualCents(amountCents, draft.billingCycle);

  const container = prefersReducedMotion ? undefined : staggerContainer(0.06);

  return (
    <motion.div
      variants={container}
      initial={prefersReducedMotion ? undefined : "hidden"}
      animate={prefersReducedMotion ? undefined : "visible"}
      className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"
    >
      <motion.p variants={prefersReducedMotion ? undefined : fadeInUp} className="text-xs text-muted-foreground">
        You typed <span className="italic">&ldquo;{originalText}&rdquo;</span>
      </motion.p>

      <motion.p variants={prefersReducedMotion ? undefined : fadeInUp} className="text-sm">
        <span className="font-medium">{draft.name || "This subscription"}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="font-financial">{formatCents(amountCents, draft.currency)}</span>
        <span className="text-muted-foreground">/{draft.billingCycle === "monthly" ? "mo" : draft.billingCycle}</span>
        <span className="text-muted-foreground"> · {CATEGORY_LABELS[draft.category]}</span>
      </motion.p>

      <motion.p variants={prefersReducedMotion ? undefined : fadeInUp} className="text-sm text-muted-foreground">
        That&apos;s <span className="font-financial text-foreground">{formatCents(yearlyCents, draft.currency)}</span> a
        year.
      </motion.p>

      {!dateProvided || confidence !== "high" ? (
        <motion.p
          variants={prefersReducedMotion ? undefined : fadeInUp}
          className="flex items-start gap-1.5 text-xs text-warning"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {!dateProvided
            ? "Couldn't tell when this renews — pick a date below."
            : "Worth a quick check against the fields below."}
        </motion.p>
      ) : null}
    </motion.div>
  );
}
