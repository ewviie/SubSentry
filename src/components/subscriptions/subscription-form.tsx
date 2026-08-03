"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BILLING_CYCLE_LABELS,
  CATEGORY_LABELS,
  STATUS_LABELS,
} from "@/lib/subscriptions/labels";
import { BILLING_CYCLES, CATEGORIES, STATUSES } from "@/lib/subscriptions/validation";
import type { Subscription } from "@/lib/db/schema";
import { centsToAmountString } from "@/lib/subscriptions/money";

export interface SubscriptionFormValues {
  name: string;
  amount: string;
  currency: string;
  billingCycle: (typeof BILLING_CYCLES)[number];
  category: (typeof CATEGORIES)[number];
  nextRenewalDate: string;
  status: (typeof STATUSES)[number];
  notes: string;
}

// toISOString() is UTC, so for users behind UTC (US timezones, etc.) this
// would show tomorrow's date as "today" for part of the evening.
function todayISO(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function subscriptionToFormValues(subscription: Subscription): SubscriptionFormValues {
  return {
    name: subscription.name,
    amount: centsToAmountString(subscription.amountCents),
    currency: subscription.currency,
    billingCycle: subscription.billingCycle,
    category: subscription.category,
    nextRenewalDate: subscription.nextRenewalDate,
    status: subscription.status,
    notes: subscription.notes ?? "",
  };
}

const emptyValues: SubscriptionFormValues = {
  name: "",
  amount: "",
  currency: "usd",
  billingCycle: "monthly",
  category: "other",
  nextRenewalDate: todayISO(),
  status: "active",
  notes: "",
};

export function SubscriptionForm({
  initialValues,
  showStatus = false,
  submitLabel,
  onSubmit,
}: {
  initialValues?: SubscriptionFormValues;
  showStatus?: boolean;
  submitLabel: string;
  onSubmit: (values: SubscriptionFormValues) => Promise<{ error?: string }>;
}) {
  const [values, setValues] = useState<SubscriptionFormValues>(initialValues ?? emptyValues);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof SubscriptionFormValues>(key: K, value: SubscriptionFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await onSubmit(values);
      if (result.error) {
        setError(result.error);
      }
    } catch {
      setError("Couldn't save the subscription. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            required
            placeholder="Netflix"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            required
            inputMode="decimal"
            placeholder="15.99"
            value={values.amount}
            onChange={(e) => update("amount", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            required
            maxLength={3}
            placeholder="usd"
            className="uppercase placeholder:normal-case"
            value={values.currency}
            onChange={(e) => update("currency", e.target.value.toLowerCase())}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="billingCycle">Billing cycle</Label>
          <Select
            value={values.billingCycle}
            onValueChange={(v) => update("billingCycle", v as SubscriptionFormValues["billingCycle"])}
          >
            <SelectTrigger id="billingCycle" className="w-full">
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

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={values.category}
            onValueChange={(v) => update("category", v as SubscriptionFormValues["category"])}
          >
            <SelectTrigger id="category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nextRenewalDate">Next renewal</Label>
          <Input
            id="nextRenewalDate"
            type="date"
            required
            value={values.nextRenewalDate}
            onChange={(e) => update("nextRenewalDate", e.target.value)}
          />
        </div>

        {showStatus ? (
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={values.status}
              onValueChange={(v) => update("status", v as SubscriptionFormValues["status"])}
            >
              <SelectTrigger id="status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            rows={3}
            value={values.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Saving…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}
