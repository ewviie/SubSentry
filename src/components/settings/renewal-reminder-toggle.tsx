"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Saves immediately on toggle (no separate edit/save/cancel state, unlike
// EditNameForm) — a checkbox's own checked state already IS the save
// intent, there's nothing a confirm step would add here. Same "at least
// one legitimate control to turn this off" this preference exists for in
// the first place is also reachable from here, not only from the email's
// unsubscribe link — see renewal-reminders.ts's own comment on why the
// default is `true`.
export function RenewalReminderToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function handleChange(next: boolean) {
    const previous = checked;
    setChecked(next); // optimistic — reverted below on failure
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renewalRemindersEnabled: next }),
      });
      if (!res.ok) {
        setChecked(previous);
        toast.error("Couldn't save that change. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setChecked(previous);
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor="renewal-reminders-toggle">Renewal reminder emails</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Get an email a few days before a subscription renews.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" /> : null}
        <Checkbox
          id="renewal-reminders-toggle"
          checked={checked}
          onCheckedChange={(value) => handleChange(value === true)}
          disabled={saving}
        />
      </div>
    </div>
  );
}
