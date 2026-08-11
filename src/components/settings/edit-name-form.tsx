"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EditNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message = data?.message ?? "Couldn't save your name. Try again.";
        // Both, deliberately: the toast catches anyone not looking at this
        // exact spot when it fires; the inline message is what a
        // screen-reader user (whose focus never left this input) actually
        // hears, and it's what's still on screen after the toast times out.
        toast.error(message);
        setError(message);
        return;
      }
      toast.success("Name updated");
      setEditing(false);
      router.refresh();
    } catch {
      const message = "Network error. Try again.";
      toast.error(message);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(initialName);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Name</span>
        <div className="flex items-center gap-1.5">
          <span>{initialName || "—"}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" onClick={() => setEditing(true)} aria-label="Edit name">
                  <Pencil className="size-3" />
                </Button>
              }
            />
            <TooltipContent>Edit name</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-muted-foreground">Name</span>
        <div className="flex items-center gap-1.5">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="h-7 w-40"
            maxLength={120}
            autoFocus
            disabled={saving}
            aria-label="Name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "edit-name-error" : undefined}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" onClick={handleSave} disabled={saving} aria-label="Save name">
                  {saving ? (
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Check className="size-3" />
                  )}
                </Button>
              }
            />
            <TooltipContent>Save name</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" onClick={handleCancel} disabled={saving} aria-label="Cancel">
                  <X className="size-3" />
                </Button>
              }
            />
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {error ? (
        <p id="edit-name-error" role="alert" className="text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
