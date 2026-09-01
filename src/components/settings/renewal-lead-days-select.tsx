"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RENEWAL_REMINDER_LEAD_DAYS_OPTIONS } from "@/lib/subscriptions/filters";

const OPTION_LABEL: Record<number, string> = {
  1: "1 day before",
  3: "3 days before",
  7: "1 week before",
  14: "2 weeks before",
  30: "1 month before",
};

// How far ahead the renewal-reminder email (renewal-reminders.ts) fires —
// replaces the previously-fixed 1-3 day window. Saves on change, same
// immediate-save posture as renewal-reminder-toggle.tsx's own checkbox,
// just for a <select> instead.
export function RenewalLeadDaysSelect({ initialValue }: { initialValue: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialValue));
  const [saving, setSaving] = useState(false);

  async function handleChange(next: string | null) {
    if (next === null) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renewalReminderLeadDays: Number(next) }),
      });
      if (!res.ok) {
        setValue(previous);
        toast.error("Couldn't save that change. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor="renewal-lead-days-select">Renewal reminder lead time</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">How far ahead to email you before a renewal.</p>
      </div>
      <Select value={value} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger id="renewal-lead-days-select" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RENEWAL_REMINDER_LEAD_DAYS_OPTIONS.map((days) => (
            <SelectItem key={days} value={String(days)}>
              {OPTION_LABEL[days]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
