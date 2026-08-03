"use client";

import { Pencil, X } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
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
  sourceLabel,
  onToggleSelected,
  onEdit,
  onToggleIgnored,
}: {
  detected: DetectedSubscription;
  currentValues: SubscriptionFormValues;
  selected: boolean;
  ignored: boolean;
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
          disabled={ignored}
          aria-label={`Select ${currentValues.name}`}
        />
      </TableCell>
      <TableCell className="max-w-48 truncate text-muted-foreground" title={rawMerchant}>
        {rawMerchant}
      </TableCell>
      <TableCell className="font-medium">{currentValues.name}</TableCell>
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
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(detected.id)}
            aria-label={`Edit ${currentValues.name}`}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleIgnored(detected.id)}
            aria-label={ignored ? `Restore ${currentValues.name}` : `Ignore ${currentValues.name}`}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
