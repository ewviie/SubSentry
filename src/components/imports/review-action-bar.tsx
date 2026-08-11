"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { springSmooth } from "@/lib/motion";
import { formatCents } from "@/lib/subscriptions/money";

// Same floating-pill pattern as bulk-action-bar.tsx: fixed to the bottom,
// only rendered while there's a selection, AnimatePresence + springSmooth
// slide-up/down.
export function ReviewActionBar({
  selectedCount,
  total,
  atImportCap,
  busy,
  onConfirm,
}: {
  selectedCount: number;
  // null whenever the selection spans more than one currency — see
  // sumMonthlyCentsIfSingleCurrency's own comment. Omitted from the bar
  // entirely rather than shown as a wrong or misleadingly-labeled number.
  total: { totalMonthlyCents: number; currency: string } | null;
  atImportCap: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {selectedCount > 0 ? (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={springSmooth}
          className="fixed inset-x-0 bottom-[calc(--spacing(4)+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-1.5 px-4"
        >
          {atImportCap ? (
            <span className="rounded-full bg-popover px-3 py-1 text-xs text-muted-foreground shadow-elevation-low">
              Max 200 per import — deselect some to add others
            </span>
          ) : null}
          <div className="flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-2 shadow-elevation-high ring-1 ring-foreground/10">
            <span className="px-2 text-sm font-medium tabular-nums">
              {selectedCount} selected
              {total ? ` · ${formatCents(total.totalMonthlyCents, total.currency)}/mo` : ""}
            </span>
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Importing…
                </>
              ) : (
                `Import ${selectedCount} selected`
              )}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
