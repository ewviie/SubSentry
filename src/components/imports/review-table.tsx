"use client";

import { useState } from "react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ReviewRow } from "./review-row";
import { ReviewActionBar } from "./review-action-bar";
import { EditDetectedRowDialog } from "./edit-detected-row-dialog";
import { centsToAmountString } from "@/lib/subscriptions/money";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

function detectedToFormValues(detected: DetectedSubscription): SubscriptionFormValues {
  return {
    name: detected.merchant.displayName,
    amount: centsToAmountString(detected.amountCents),
    currency: detected.transactions[0]?.currency ?? "usd",
    billingCycle: detected.estimatedBillingCycle.cycle,
    category: detected.merchant.category,
    nextRenewalDate: detected.suggestedNextRenewalDate,
    status: "active",
    notes: "",
  };
}

export function ReviewTable({
  detected,
  sourceLabel,
  busy,
  onConfirm,
}: {
  detected: DetectedSubscription[];
  sourceLabel: string;
  busy: boolean;
  onConfirm: (rows: SubscriptionFormValues[], ignoredCount: number) => void;
}) {
  // Only high-confidence rows are pre-selected — everything else requires
  // explicit user action, per the product requirement that nothing is ever
  // silently imported.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(detected.filter((d) => d.confidence === "high").map((d) => d.id)),
  );
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Map<string, SubscriptionFormValues>>(
    () => new Map(detected.map((d) => [d.id, detectedToFormValues(d)])),
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleIgnored(id: string) {
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setSelectedIds((selected) => {
          const nextSelected = new Set(selected);
          nextSelected.delete(id);
          return nextSelected;
        });
      }
      return next;
    });
  }

  const selectableIds = detected.filter((d) => !ignoredIds.has(d.id)).map((d) => d.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }

  const editingValues = editingId ? (values.get(editingId) ?? null) : null;

  return (
    <div className="space-y-4 pb-24">
      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Merchant</TableHead>
              <TableHead>Detected name</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Billing cycle</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detected.map((row) => {
              const currentValues = values.get(row.id);
              if (!currentValues) return null;
              return (
                <ReviewRow
                  key={row.id}
                  detected={row}
                  currentValues={currentValues}
                  selected={selectedIds.has(row.id)}
                  ignored={ignoredIds.has(row.id)}
                  sourceLabel={sourceLabel}
                  onToggleSelected={toggleSelected}
                  onEdit={setEditingId}
                  onToggleIgnored={toggleIgnored}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      <EditDetectedRowDialog
        open={editingId !== null}
        initialValues={editingValues}
        onOpenChange={(open) => !open && setEditingId(null)}
        onSave={(newValues) => {
          if (editingId) setValues((prev) => new Map(prev).set(editingId, newValues));
        }}
      />

      <ReviewActionBar
        selectedCount={selectedIds.size}
        busy={busy}
        onConfirm={() => {
          const rows = [...selectedIds]
            .map((id) => values.get(id))
            .filter((v): v is SubscriptionFormValues => v !== undefined);
          onConfirm(rows, ignoredIds.size);
        }}
      />
    </div>
  );
}
