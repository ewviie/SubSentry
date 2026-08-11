"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BILLING_CYCLES } from "@/lib/subscriptions/validation";
import { BILLING_CYCLE_LABELS } from "@/lib/subscriptions/labels";
import { monthlyCents, formatCents, amountStringToCents } from "@/lib/subscriptions/money";
import type { Subscription } from "@/lib/db/schema";

type Cycle = Subscription["billingCycle"];

interface Row {
  id: string;
  name: string;
  amount: string;
  billingCycle: Cycle;
}

function emptyRow(id: string): Row {
  return { id, name: "", amount: "", billingCycle: "monthly" };
}

// Client-side only, on purpose: nothing here is sent anywhere or saved
// anywhere (no fetch, no localStorage) — the brief's own "client-side only,
// do not save user data" constraint, and it means anyone can use this
// without an account. Reuses the app's own money math (monthlyCents,
// formatCents) so "$X/year" here is computed exactly the same way the real
// dashboard computes it, not a second, looser approximation.
export function CostCalculator() {
  const idBase = useId();
  const [nextIndex, setNextIndex] = useState(1);
  const [rows, setRows] = useState<Row[]>([emptyRow(`${idBase}-0`)]);

  function addRow() {
    setRows((r) => [...r, emptyRow(`${idBase}-${nextIndex}`)]);
    setNextIndex((n) => n + 1);
  }

  function removeRow(id: string) {
    setRows((r) => r.filter((row) => row.id !== id));
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  const { monthlyTotalCents, yearlyTotalCents, activeCount } = useMemo(() => {
    let monthly = 0;
    let count = 0;
    for (const row of rows) {
      if (!row.name.trim() || !/^\d+(\.\d{1,2})?$/.test(row.amount.trim())) continue;
      monthly += monthlyCents(amountStringToCents(row.amount), row.billingCycle);
      count += 1;
    }
    return { monthlyTotalCents: monthly, yearlyTotalCents: monthly * 12, activeCount: count };
  }, [rows]);

  return (
    <div className="space-y-6">
      <Card size="sm">
        <CardContent className="space-y-4">
          {rows.map((row, i) => (
            <div key={row.id} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_140px_160px_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`${row.id}-name`}>{i === 0 ? "Subscription" : undefined}</Label>
                <Input
                  id={`${row.id}-name`}
                  placeholder="Netflix"
                  value={row.name}
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.id}-amount`}>{i === 0 ? "Amount" : undefined}</Label>
                <Input
                  id={`${row.id}-amount`}
                  inputMode="decimal"
                  placeholder="15.99"
                  value={row.amount}
                  onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.id}-cycle`}>{i === 0 ? "Billing cycle" : undefined}</Label>
                <Select value={row.billingCycle} onValueChange={(v) => updateRow(row.id, { billingCycle: v as Cycle })}>
                  <SelectTrigger id={`${row.id}-cycle`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_CYCLES.map((cycle) => (
                      <SelectItem key={cycle} value={cycle}>
                        {BILLING_CYCLE_LABELS[cycle]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${row.name || "row"}`}
                      disabled={rows.length === 1}
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>Remove {row.name || "row"}</TooltipContent>
              </Tooltip>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-fit">
            <Plus className="size-4" aria-hidden="true" />
            Add another
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className={activeCount > 0 ? "border-emerald/30 shadow-elevation-glow ring-1 ring-emerald/20" : ""}>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center sm:text-left">
            <div>
              <p className="text-sm text-muted-foreground">Subscriptions</p>
              <p className="font-mono text-2xl font-semibold tabular-nums">{activeCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Monthly total</p>
              <p className="font-mono text-2xl font-semibold tabular-nums">{formatCents(monthlyTotalCents)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Yearly total</p>
              <p className="font-mono text-2xl font-semibold tabular-nums text-emerald">{formatCents(yearlyTotalCents)}</p>
            </div>
          </div>

          {activeCount > 0 ? (
            <div className="mt-6 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">
                That&apos;s <span className="font-medium text-foreground">{formatCents(yearlyTotalCents)}/year</span> across{" "}
                {activeCount} subscription{activeCount === 1 ? "" : "s"} — SubSentry keeps this list for you, flags
                duplicates, and tracks it automatically as prices change.
              </p>
              <Button className="mt-4 w-fit" render={<Link href="/signup" />} nativeButton={false}>
                Start tracking this for free
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
