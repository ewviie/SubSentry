"use client";

import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SubscriptionForm, type SubscriptionFormValues } from "@/components/subscriptions/subscription-form";

// Same reuse pattern quick-add-bar.tsx already established for its own
// confirm dialog: wrap the existing SubscriptionForm rather than building a
// second form. Saving only mutates the parent's local state (review-table.tsx)
// — nothing is persisted until the review screen's final bulk confirm.
export function EditDetectedRowDialog({
  open,
  initialValues,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialValues: SubscriptionFormValues | null;
  onOpenChange: (open: boolean) => void;
  onSave: (values: SubscriptionFormValues) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4 text-muted-foreground" />
            Edit detected subscription
          </DialogTitle>
          <DialogDescription>Adjust any field before importing it.</DialogDescription>
        </DialogHeader>
        {initialValues ? (
          <SubscriptionForm
            initialValues={initialValues}
            submitLabel="Save"
            onSubmit={async (values) => {
              onSave(values);
              onOpenChange(false);
              return {};
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
