"use client";

import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import type { PriceChangeProposal } from "@/lib/imports/types";

// A distinct third classification alongside "new subscription" (the default
// checkbox row) and "duplicate/ignored" (review-row.tsx's badge + Ignore
// button), a strong-confidence match whose detected amount differs
// meaningfully from what's already tracked. Rendered as its own full-width
// row (colSpan) directly under the detected row it belongs to, not a new
// card/modal, so this stays one more row in the same table rather than a
// second UI language for what's still fundamentally one review list.
//
// Never touches data itself: both actions are explicit, user-initiated
// (see review-table.tsx's onUpdatePrice/onKeepExisting), matching this
// app's "nothing is ever silently imported" principle applied to price
// changes specifically.
export function PriceChangeProposalRow({
  proposal,
  busy,
  onUpdatePrice,
  onKeepExisting,
}: {
  proposal: PriceChangeProposal;
  busy: boolean;
  onUpdatePrice: () => void;
  onKeepExisting: () => void;
}) {
  const increased = proposal.percentChange > 0;
  const Icon = increased ? TrendingUp : TrendingDown;

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={9} className="py-3">
        <div className="flex flex-wrap items-center gap-3 pl-8 text-sm">
          <Icon
            className={increased ? "size-4 shrink-0 text-destructive" : "size-4 shrink-0 text-emerald"}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Possible price change</p>
            <p className="text-muted-foreground">
              This looks like your existing <span className="font-medium text-foreground">{proposal.existingName}</span>,{" "}
              {formatCents(proposal.existingAmountCents, proposal.currency)} tracked vs.{" "}
              {formatCents(proposal.detectedAmountCents, proposal.currency)} detected (
              <span className={increased ? "text-destructive" : "text-emerald"}>
                {increased ? "+" : ""}
                {Math.round(proposal.percentChange)}%, {increased ? "+" : ""}
                {formatCents(proposal.annualDeltaCents, proposal.currency)}/yr
              </span>
              ).
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* aria-label on both: the visible text alone ("Update price",
                "Keep existing") is a distinct-enough affordance for a
                sighted user reading one row at a time, but identical across
                every proposal row in a larger import; a screen reader user
                navigating via a buttons-only list (VoiceOver rotor, NVDA/
                JAWS 'b' key) hears a flat "Update price, button" repeated
                once per proposal with no way to tell which subscription
                each belongs to, unlike the per-row context review-row.tsx's
                own Edit/Ignore buttons already carry this same way (product
                council review, Accessibility lens). */}
            <Button
              size="sm"
              variant="outline"
              onClick={onKeepExisting}
              disabled={busy}
              aria-label={`Keep ${proposal.existingName} at its existing price`}
            >
              Keep existing
            </Button>
            <Button
              size="sm"
              onClick={onUpdatePrice}
              disabled={busy}
              aria-label={`Update ${proposal.existingName}'s price to ${formatCents(proposal.detectedAmountCents, proposal.currency)}`}
            >
              {/* Loader2 + text swap while busy, same convention every
                  other async button in this app already follows
                  (review-action-bar.tsx's Confirm button, subscription-form.tsx's
                  Save, bulk-action-bar.tsx, ...). Disabling alone isn't
                  reliably announced by a screen reader, so without this a
                  PATCH round-trip was silent until the toast landed (product
                  council review, Accessibility lens). */}
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Updating…
                </>
              ) : (
                "Update price"
              )}
            </Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
