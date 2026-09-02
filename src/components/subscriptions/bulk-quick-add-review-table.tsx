"use client";

import { useState } from "react";
import { Pencil, X, AlertCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfidenceBadge } from "@/components/imports/confidence-badge";
import { EditDetectedRowDialog } from "@/components/imports/edit-detected-row-dialog";
import { toFormValues } from "@/components/subscriptions/quick-add-bar";
import { CATEGORY_LABELS, BILLING_CYCLE_LABELS } from "@/lib/subscriptions/labels";
import { amountStringToCents, formatCents, sumMonthlyCentsIfSingleCurrency } from "@/lib/subscriptions/money";
import type { SubscriptionFormValues } from "@/components/subscriptions/subscription-form";
import type { BulkQuickAddLineResult } from "@/lib/ai/bulk-quick-add";

interface DraftRow {
  id: string;
  line: number;
  rawText: string;
  confidence: "high" | "medium" | "low";
  values: SubscriptionFormValues;
}

// Review step, same "nothing is saved until you confirm" contract as the
// single quick-add dialog (quick-add-summary.tsx) and the Import Center's
// own ReviewTable — reused here in spirit (Table/EditDetectedRowDialog/
// ConfidenceBadge are the exact same components), not in implementation:
// ReviewTable's own state (duplicate-of-existing badges, price-change
// proposals, checkbox multi-select) all exist to handle bank-transaction
// clustering, which a hand-pasted line has none of. Every parsed line here
// was something the user explicitly typed/pasted, so the natural default
// is "keep everything, remove what you don't want" (a plain per-row Edit/
// Remove pair) rather than a checkbox selection the CSV flow needs because
// most detected rows there are NOT things a human directly asked for.
export function BulkQuickAddReviewTable({
  results,
  omittedLineCount,
  busy,
  onConfirm,
}: {
  results: BulkQuickAddLineResult[];
  omittedLineCount: number;
  busy: boolean;
  onConfirm: (rows: SubscriptionFormValues[]) => void;
}) {
  const okResults = results.filter((r) => r.ok);
  const failedResults = results.filter((r) => !r.ok);

  const [rows, setRows] = useState<DraftRow[]>(() =>
    okResults.map((r) => ({
      id: `line-${r.line}`,
      line: r.line,
      rawText: r.rawText,
      confidence: r.confidence,
      values: toFormValues(r.subscription),
    })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function saveRow(id: string, values: SubscriptionFormValues) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, values } : r)));
  }

  const editingValues = editingId ? (rows.find((r) => r.id === editingId)?.values ?? null) : null;

  // A row whose parser couldn't determine a renewal date at all (the
  // DemoProvider never even attempts to — see its own comment; a real
  // model call can genuinely fail to find one too) carries
  // nextRenewalDate: "" (quickAddSubscription's own deliberate "don't
  // guess a date" behavior — parse-subscription.ts). The single quick-add
  // dialog forces this to be filled in before its one Confirm button is
  // ever reachable, via the SubscriptionForm's own `required` date input;
  // this table has no such single choke point (each row confirms as part
  // of one shared batch), so a row missing a date is excluded from what
  // gets sent until its own Edit dialog — the exact same SubscriptionForm,
  // same required input — is used to set one. Never silently sent with a
  // blank date (the server's own subscriptionInputSchema would reject that
  // for the whole batch anyway); this surfaces it before that round trip.
  const readyRows = rows.filter((r) => r.values.nextRenewalDate !== "");
  const needsDateCount = rows.length - readyRows.length;
  const total = sumMonthlyCentsIfSingleCurrency(readyRows.map((r) => r.values));

  return (
    <div className="space-y-4">
      {/* Lines that never became an editable row — a genuinely honest
          outcome (a schema-rejected line, a parse the model itself
          couldn't produce a valid draft for, or a line skipped because
          this request's own AI-quota reservation ran out first — see
          bulk-quick-add.ts's own comment on rateLimited) rather than a
          silent guess or a silently dropped line. Shown as plain text, not
          editable rows: there's no parsed draft to edit for these. */}
      {failedResults.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {failedResults.length === 1 ? "1 line couldn't be understood" : `${failedResults.length} lines couldn't be understood`}
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {failedResults.map((r) => (
              <li key={r.line}>
                <span className="italic">&ldquo;{r.rawText}&rdquo;</span> — {r.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {omittedLineCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          Only the first {results.length} line{results.length === 1 ? "" : "s"} were parsed — paste the rest separately.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Billing cycle</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.values.name}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {formatCents(amountStringToCents(row.values.amount), row.values.currency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{BILLING_CYCLE_LABELS[row.values.billingCycle]}</TableCell>
                  <TableCell className="text-muted-foreground">{CATEGORY_LABELS[row.values.category]}</TableCell>
                  <TableCell>
                    {row.values.nextRenewalDate === "" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                        <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                        Needs a date
                      </span>
                    ) : (
                      <ConfidenceBadge confidence={row.confidence} />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditingId(row.id)}
                              aria-label={`Edit ${row.values.name}`}
                            />
                          }
                        >
                          <Pencil className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeRow(row.id)}
                              aria-label={`Remove ${row.values.name}`}
                            />
                          }
                        >
                          <X className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing left to add — every row was removed.</p>
      )}

      <EditDetectedRowDialog
        open={editingId !== null}
        initialValues={editingValues}
        onOpenChange={(open) => !open && setEditingId(null)}
        onSave={(values) => {
          if (editingId) saveRow(editingId, values);
        }}
      />

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {readyRows.length} ready to add
          {total ? ` · ${formatCents(total.totalMonthlyCents, total.currency)}/mo total` : ""}
          {needsDateCount > 0
            ? ` · ${needsDateCount} need${needsDateCount === 1 ? "s" : ""} a renewal date first (Edit to set one)`
            : ""}
        </span>
        <Button onClick={() => onConfirm(readyRows.map((r) => r.values))} disabled={busy || readyRows.length === 0}>
          {busy ? "Adding…" : `Add ${readyRows.length} subscription${readyRows.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
