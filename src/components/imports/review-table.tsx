"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ReviewRow } from "./review-row";
import { ReviewActionBar } from "./review-action-bar";
import { EditDetectedRowDialog } from "./edit-detected-row-dialog";
import { PriceChangeProposalRow } from "./price-change-proposal-row";
import { centsToAmountString, sumMonthlyCentsIfSingleCurrency } from "@/lib/subscriptions/money";
import { MAX_SUBSCRIPTION_NAME_LENGTH } from "@/lib/subscriptions/validation";
import { MAX_IMPORT_ROWS } from "@/lib/imports/validation";
import type { DetectedSubscription } from "@/lib/imports/types";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

// Exported for review-table.test.ts, same "plain function, no component-
// test harness" reasoning as detectedToFormValues below.
//
// High confidence alone used to be the only bar for landing pre-selected.
// detectRecurringSubscriptions() (lib/imports/detection.ts) also computes
// isDuplicateOfExistingId (a fuzzy match against the user's own existing
// subscriptions), but nothing here ever read it: a high-confidence cluster
// that's actually a duplicate of something already tracked got checked by
// default and could be silently re-imported as a second, real, recurring
// charge with one click on Confirm. reveal-step.tsx already tells the user
// about this in aggregate ("Including N possible duplicates...") one screen
// earlier, but the actual decision happens here, per row: that's where the
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
    // Truncated here, not in merchant-normalizer.ts's displayName: that
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
  // Only high-confidence, non-duplicate rows are pre-selected. Everything
  // else requires explicit user action, per the product requirement that
  // nothing is ever silently imported (see isPreselectedByDefault's own
  // comment above for why duplicates are excluded here specifically).
  // Sliced to MAX_IMPORT_ROWS same as toggleSelectAll/toggleSelected below:
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
  // Rows whose price-change proposal has already been acted on (either
  // direction). Once resolved, the proposal row disappears and the
  // detected row itself is treated as ignored (excluded from the
  // new-subscription batch either way: "Update price" already applied the
  // change to the existing subscription; "Keep existing" means there's
  // nothing left to import). Tracked separately from ignoredIds so a
  // network failure on "Update price" can leave the row genuinely
  // unresolved (still showing the proposal, not silently marked handled)
  // rather than optimistically hiding it before the write actually landed.
  const [resolvedProposalIds, setResolvedProposalIds] = useState<Set<string>>(new Set());
  // A Set, not a single id: two proposals updated back-to-back before the
  // first PATCH resolves used to share one `priceUpdateBusyId` string, so
  // starting the second request cleared the first row's busy state in the
  // UI (its button visually re-enabled) while that first PATCH was still
  // genuinely in flight (CodeRabbit review). Each row's own busy state now
  // only ever depends on its own request.
  const [priceUpdateBusyIds, setPriceUpdateBusyIds] = useState<Set<string>>(new Set());

  // A resolved proposal (either "Update price," a real write against the
  // existing subscription, or "Keep existing") must stay excluded from the
  // create batch permanently. Un-ignoring it via the row's own Restore
  // button (the same X/Restore control a plain Ignore uses) would silently
  // re-enable its checkbox with no re-shown proposal/warning, letting the
  // user select and confirm a brand-new, duplicate subscription for a
  // charge whose price was already reconciled (CodeRabbit review). Restore
  // is a no-op for any id in this set; every other row's Ignore/Restore
  // keeps working exactly as before.
  function toggleIgnored(id: string) {
    if (resolvedProposalIds.has(id)) return;
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

  // Shared by both proposal-resolution paths below. Marks a row resolved +
  // ignored (same ignoredIds mechanism a plain "Ignore" already uses, so
  // it's excluded from the create batch and the import's
  // completedIgnoredCount for free) AND clears it from selectedIds.
  // Without that last step, a row the user had manually checked (the
  // checkbox stays enabled during a pending proposal on purpose, see the
  // Ignore button's own "nothing force-deselected" precedent) would still
  // be included in `selectedRows`/onConfirm's batch after being resolved,
  // creating exactly the duplicate subscription this feature exists to
  // prevent. `toggleIgnored` already did this same three-way update for a
  // plain Ignore click; these two handlers need the identical guarantee
  // (CodeRabbit review; this was missing here).
  function resolveProposal(id: string) {
    setResolvedProposalIds((prev) => new Set(prev).add(id));
    setIgnoredIds((prev) => new Set(prev).add(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // "Keep existing": dismisses the proposal without touching any data.
  // the existing subscription's price is untouched, and this transaction
  // cluster is treated as fully handled.
  function handleKeepExisting(id: string) {
    resolveProposal(id);
  }

  // "Update price": the one place this table writes data outside the
  // eventual batch confirm. Reuses the existing, unmodified PATCH
  // /api/subscriptions/[id] endpoint (same ownership/authorization checks,
  // same updateSubscription price-history write path as a manual edit),
  // tagged priceHistorySource: "import_update" purely for provenance. Never
  // optimistic: resolvedProposalIds/ignoredIds only update after a
  // confirmed 2xx, so a network failure leaves the proposal visibly
  // unresolved rather than silently marking it handled.
  async function handleUpdatePrice(detected: DetectedSubscription) {
    const proposal = detected.priceChangeProposal;
    if (!proposal) return;
    setPriceUpdateBusyIds((prev) => new Set(prev).add(detected.id));
    try {
      const res = await fetch(`/api/subscriptions/${proposal.existingSubscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: centsToAmountString(proposal.detectedAmountCents),
          billingCycle: proposal.detectedBillingCycle,
          priceHistorySource: "import_update",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Couldn't update the price. Try again.");
        return;
      }
      toast.success(`${proposal.existingName}'s price updated.`);
      resolveProposal(detected.id);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setPriceUpdateBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(detected.id);
        return next;
      });
    }
  }

  const selectableIds = detected.filter((d) => !ignoredIds.has(d.id)).map((d) => d.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selectedIds.has(id));

  // Capped at MAX_IMPORT_ROWS: /api/imports/confirm's importConfirmSchema
  // rejects a `rows` array past that bound with a generic validation
  // error. A user with a large legitimate bank history selecting "all" past
  // the cap is a real, near-term case (not hypothetical), so this selects
  // as many as actually fit rather than all of them, and the note below
  // explains why fewer got selected than expected.
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds.slice(0, MAX_IMPORT_ROWS)));
  }

  const atImportCap = selectedIds.size >= MAX_IMPORT_ROWS;

  // Same cap as toggleSelectAll above: a no-op past MAX_IMPORT_ROWS rather
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
  // selected row shares one currency. See sumMonthlyCentsIfSingleCurrency's
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
              const proposal = row.priceChangeProposal;
              const showProposal = proposal && !resolvedProposalIds.has(row.id);
              return (
                <Fragment key={row.id}>
                  <ReviewRow
                    detected={row}
                    currentValues={currentValues}
                    selected={selectedIds.has(row.id)}
                    ignored={ignoredIds.has(row.id)}
                    sourceLabel={sourceLabel}
                    onToggleSelected={toggleSelected}
                    onEdit={setEditingId}
                    onToggleIgnored={toggleIgnored}
                  />
                  {showProposal ? (
                    <PriceChangeProposalRow
                      proposal={proposal}
                      busy={priceUpdateBusyIds.has(row.id)}
                      onUpdatePrice={() => handleUpdatePrice(row)}
                      onKeepExisting={() => handleKeepExisting(row.id)}
                    />
                  ) : null}
                </Fragment>
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
