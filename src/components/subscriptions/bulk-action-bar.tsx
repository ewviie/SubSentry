"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { springSmooth } from "@/lib/motion";
import type { Subscription } from "@/lib/db/schema";

const STATUS_OPTIONS: { value: Subscription["status"]; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "canceled", label: "Canceled" },
];

export function BulkActionBar({
  selectedCount,
  onClear,
  onChangeStatus,
  onDelete,
  busy,
}: {
  selectedCount: number;
  onClear: () => void;
  onChangeStatus: (status: Subscription["status"]) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <AnimatePresence>
      {selectedCount > 0 ? (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={springSmooth}
          className="fixed inset-x-0 bottom-[calc(--spacing(4)+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
        >
          {/* overflow-x-auto + max-w-full: this pill's own safety valve if
              it ever doesn't fit a narrow phone screen, rather than
              silently forcing the whole page wider or wrapping a
              rounded-full pill into a broken two-line shape. Also dropped
              the standalone "Archive" button that used to sit here: it was
              a plain shortcut for onChangeStatus("paused"), which "Change
              status" already offers as one of its own options — the same
              action reachable two ways on a bar that's supposed to be the
              compact, fast path. */}
          <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-border bg-popover px-3 py-2 shadow-elevation-high ring-1 ring-foreground/10">
            <span className="shrink-0 px-2 text-sm font-medium tabular-nums">
              {selectedCount} selected
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="shrink-0" disabled={busy}>
                    Change status
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  </Button>
                }
              />
              <DropdownMenuContent align="center" side="top">
                {STATUS_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.value} onClick={() => onChangeStatus(option.value)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" size="sm" className="shrink-0" disabled={busy}>
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {selectedCount} subscription{selectedCount === 1 ? "" : "s"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes {selectedCount === 1 ? "it" : "them"} and their history permanently.
                    This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onDelete} disabled={busy}>
                    {busy ? (
                      <>
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Deleting…
                      </>
                    ) : (
                      "Delete"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={onClear} aria-label="Clear selection" disabled={busy}>
                    <X className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>Clear selection</TooltipContent>
            </Tooltip>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
