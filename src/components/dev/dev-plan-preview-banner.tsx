"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { DevPlanPreview } from "@/lib/dev/plan-preview";

// Rendered only by (app)/layout.tsx, and only when
// isDevPlanPreviewAvailable() is true server-side (see that file) — this
// component's own JS never even ships to a production build, since the
// server never includes it in the tree to begin with. Amber, not any of
// the app's own semantic colors (emerald/destructive/etc.): this needs to
// read unmistakably as a development tool bolted onto the product, never
// as a real product surface a user could mistake for their actual plan
// status.
export function DevPlanPreviewBanner({ current }: { current: DevPlanPreview | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function setPreview(plan: DevPlanPreview | null) {
    setPending(true);
    try {
      const res = await fetch("/api/dev/plan-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        toast.error("Couldn't switch the preview. Try again.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  const label = current === "pro" ? "Pro" : current === "free" ? "Free" : "Off — real plan";

  return (
    <div
      role="status"
      className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 shadow-elevation-medium dark:bg-amber-950 dark:text-amber-200"
    >
      {pending ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      <span>DEV PREVIEW — {label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPreview("free")}
          disabled={pending || current === "free"}
          className="rounded-full border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-40"
        >
          Free
        </button>
        <button
          type="button"
          onClick={() => setPreview("pro")}
          disabled={pending || current === "pro"}
          className="rounded-full border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-40"
        >
          Pro
        </button>
        <button
          type="button"
          onClick={() => setPreview(null)}
          disabled={pending || current === null}
          className="rounded-full border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-40"
        >
          Real
        </button>
      </div>
    </div>
  );
}
