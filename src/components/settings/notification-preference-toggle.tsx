"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Generalized version of renewal-reminder-toggle.tsx's own pattern (save
// immediately on toggle, optimistic with a revert-on-failure) — that
// component predates this one and is left as its own file rather than
// rewritten to use this, since it's already shipped and working; this
// covers every *other* boolean preference api/me/route.ts now accepts
// (priceAlertEmailsEnabled, weeklyDigestEnabled) without a third near-
// identical copy for each.
export function NotificationPreferenceToggle({
  field,
  label,
  description,
  initialEnabled,
}: {
  field: "priceAlertEmailsEnabled" | "weeklyDigestEnabled";
  label: string;
  description: string;
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const inputId = `${field}-toggle`;

  async function handleChange(next: boolean) {
    const previous = checked;
    setChecked(next);
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
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
        <Label htmlFor={inputId}>{label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" /> : null}
        <Checkbox id={inputId} checked={checked} onCheckedChange={(value) => handleChange(value === true)} disabled={saving} />
      </div>
    </div>
  );
}
