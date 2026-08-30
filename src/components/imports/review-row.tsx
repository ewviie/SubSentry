"use client";

import { Copy, Pencil, X } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfidenceBadge } from "./confidence-badge";
import { CATEGORY_LABELS, BILLING_CYCLE_LABELS } from "@/lib/subscriptions/labels";
import { amountStringToCents, formatCents } from "@/lib/subscriptions/money";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

export function ReviewRow({
  detected,
  currentValues,
  selected,
  ignored,
  proposalPending,
  sourceLabel,
  onToggleSelected,
  onEdit,
  onToggleIgnored,
}: {
  detected: DetectedSubscription;
  currentValues: SubscriptionFormValues;
  selected: boolean;
  ignored: boolean;
  // True while this row's price-change proposal (rendered by
  // PriceChangeProposalRow directly below) is still unresolved — "Update
  // price" or "Keep existing" hasn't been clicked yet. Disables the
  // checkbox for the same reason `ignored` does: selecting this row for
  // the create batch before that decision is made would create a
  // duplicate subscription for a charge already reconciled a different
  // way. See review-table.tsx's isBlockedByUnresolvedProposal.
  proposalPending: boolean;
  sourceLabel: string;
  onToggleSelected: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleIgnored: (id: string) => void;
}) {
  const rawMerchant = detected.transactions[0]?.description ?? currentValues.name;

  return (
    <TableRow className={ignored ? "opacity-50" : undefined} data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected(detected.id)}
          disabled={ignored || proposalPending}
          aria-label={`Select ${currentValues.name}`}
        />
      </TableCell>
      <TableCell className="max-w-48 truncate text-muted-foreground" title={rawMerchant}>
        {rawMerchant}
      </TableCell>
      <TableCell className="font-medium">
        <span className="flex items-center gap-1.5">
          {currentValues.name}
          {detected.isDuplicateOfExistingId ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex text-destructive" aria-label="Possible duplicate of a subscription you already track">
                    <Copy className="size-3.5" />
                  </span>
                }
              />
              <TooltipContent>This looks like a subscription you already track. Double-check before importing it again.</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="font-mono tabular-nums">
        {formatCents(amountStringToCents(currentValues.amount), currentValues.currency)}
      </TableCell>
      <TableCell className="text-muted-foreground">{BILLING_CYCLE_LABELS[currentValues.billingCycle]}</TableCell>
      <TableCell>
        <ConfidenceBadge confidence={detected.confidence} />
      </TableCell>
      <TableCell className="text-muted-foreground">{CATEGORY_LABELS[currentValues.category]}</TableCell>
      <TableCell className="text-muted-foreground">{sourceLabel}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(detected.id)}
                  aria-label={`Edit ${currentValues.name}`}
                >
                  <Pencil className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onToggleIgnored(detected.id)}
                  aria-label={ignored ? `Restore ${currentValues.name}` : `Ignore ${currentValues.name}`}
                >
                  <X className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>{ignored ? "Restore" : "Ignore"}</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}
