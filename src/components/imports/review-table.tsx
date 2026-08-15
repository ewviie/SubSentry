"use client";

import { useState } from "react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ReviewRow } from "./review-row";
import { ReviewActionBar } from "./review-action-bar";
import { EditDetectedRowDialog } from "./edit-detected-row-dialog";
import { centsToAmountString, sumMonthlyCentsIfSingleCurrency } from "@/lib/subscriptions/money";
import { MAX_SUBSCRIPTION_NAME_LENGTH } from "@/lib/subscriptions/validation";
import { MAX_IMPORT_ROWS } from "@/lib/imports/validation";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

// Exported for review-table.test.ts — same "plain function, no component-
// test harness" reasoning as detectedToFormValues below.
//
// High confidence alone used to be the only bar for landing pre-selected —
// detectRecurringSubscriptions() (lib/imports/detection.ts) also computes
// isDuplicateOfExistingId (a fuzzy match against the user's own existing
// subscriptions), but nothing here ever read it: a high-confidence cluster
// that's actually a duplicate of something already tracked got checked by
// default and could be silently re-imported as a second, real, recurring
// charge with one click on Confirm. reveal-step.tsx already tells the user
// about this in aggregate ("Including N possible duplicates...") one screen
// earlier, but the actual decision happens here, per row — that's where the
// signal needs to change behavior. Still just a *default*: the row's own
// checkbox (and its new duplicate badge, see review-row.tsx) lets the user
// select it anyway if they know better; nothing is force-deselected or
// hidden, matching this file's own "nothing is ever silently imported"
// principle applied in the other direction too.
export function isPreselectedByDefault(detected: DetectedSubscription): boolean {
  return detected.confidence === "high" && !detected.isDuplicateOfExistingId;
}

export function detectedToFormValues(detected: DetectedSubscription): SubscriptionFormValues {
  return {
    // Truncated here, not in merchant-normalizer.ts's displayName — that
    // string is also detection.ts's clustering key, and truncating it
    // there would make two unrelated long descriptions that only differ
    // after the cutoff collide onto the same cluster. Schema submission is
    // the one place the length cap actually needs to apply.
    name: detected.merchant.displayName.slice(0, MAX_SUBSCRIPTION_NAME_LENGTH),
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
  // Only high-confidence, non-duplicate rows are pre-selected — everything
  // else requires explicit user action, per the product requirement that
  // nothing is ever silently imported (see isPreselectedByDefault's own
  // comment above for why duplicates are excluded here specifically).
  // Sliced to MAX_IMPORT_ROWS same as toggleSelectAll/toggleSelected below —
  // a large legitimate bank history can easily produce more than 200
  // high-confidence detections, and without this the initial state itself
  // (before any user interaction) could already exceed what
  // /api/imports/confirm accepts.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(detected.filter(isPreselectedByDefault).map((d) => d.id).slice(0, MAX_IMPORT_ROWS)),
  );
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Map<string, SubscriptionFormValues>>(
    () => new Map(detected.map((d) => [d.id, detectedToFormValues(d)])),
  );
  const [editingId, setEditingId] = useState<string | null>(null);

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

  // Capped at MAX_IMPORT_ROWS — /api/imports/confirm's importConfirmSchema
  // rejects a `rows` array past that bound with a generic validation
  // error. A user with a large legitimate bank history selecting "all" past
  // the cap is a real, near-term case (not hypothetical), so this selects
  // as many as actually fit rather than all of them, and the note below
  // explains why fewer got selected than expected.
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds.slice(0, MAX_IMPORT_ROWS)));
  }

  const atImportCap = selectedIds.size >= MAX_IMPORT_ROWS;

  // Same cap as toggleSelectAll above — a no-op past MAX_IMPORT_ROWS rather
  // than letting one-at-a-time clicks reach a count toggleSelectAll itself
  // would never produce.
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_IMPORT_ROWS) {
        next.add(id);
      }
      return next;
    });
  }

  const editingValues = editingId ? (values.get(editingId) ?? null) : null;

  // Only shown to the user as a real dollar total when every currently
  // selected row shares one currency — see sumMonthlyCentsIfSingleCurrency's
  // own comment for why a mixed-currency batch can't be honestly summed
  // into one figure.
  const selectedRows = [...selectedIds]
    .map((id) => values.get(id))
    .filter((v): v is SubscriptionFormValues => v !== undefined);
  const selectedTotal = sumMonthlyCentsIfSingleCurrency(selectedRows);

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
        total={selectedTotal}
        atImportCap={atImportCap}
        busy={busy}
        onConfirm={() => onConfirm(selectedRows, ignoredIds.size)}
      />
    </div>
  );
}
