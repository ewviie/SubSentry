"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  SubscriptionForm,
  subscriptionToFormValues,
  type SubscriptionFormValues,
} from "@/components/subscriptions/subscription-form";
import { amountStringToCents, annualCents, formatCents } from "@/lib/subscriptions/money";
import type { Subscription } from "@/lib/db/schema";

// A real, always-working search link, never a claimed direct cancellation
// URL. This app has no maintained per-merchant cancel-page database (see
// lib/imports/merchant-normalizer.ts's own KNOWN_MERCHANTS table: display
// name + category only, no URLs), and fabricating one (a guessed
// netflix.com/cancel-style link per subscription) would risk sending a
// user to a wrong or dead page for something as consequential as "am I
// still being charged." A search query is honest about what SubSentry
// actually knows (the subscription's name, nothing more) and always
// resolves to something useful regardless of how the merchant's real
// cancellation flow is shaped today.
function cancelSearchUrl(name: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", `how to cancel ${name} subscription`);
  return url.toString();
}

export function EditSubscriptionForm({ subscription }: { subscription: Subscription }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [canceling, setCanceling] = useState(false);

  // A status-only PATCH: the same partial update SubscriptionsExplorer's
  // own bulk "Change status" already sends, and the same toast copy
  // handleSubmit's active→canceled branch below gives. Before this, acting
  // on this exact page's own "Recommended: cancel this" line meant opening
  // the full edit form, finding the Status field among 7 others, and
  // saving: real friction on the one action this page exists to drive.
  async function handleQuickCancel() {
    setCanceling(true);
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Couldn't cancel that. Try again.");
        return;
      }
      // Annual, not monthly — matches what actually got recorded to the
      // realized-savings ledger this same PATCH just wrote a row to
      // (queries.ts's updateSubscription; schema.ts's realizedSavings), and
      // the "$X/year" framing /savings' own "Money saved so far" card now
      // leads with (savings/page.tsx).
      const annual = annualCents(subscription.amountCents, subscription.billingCycle);
      toast.success("Canceled", {
        description: `You'll save about ${formatCents(annual, subscription.currency)}/year.`,
      });
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Couldn't cancel that. Try again.");
    } finally {
      setCanceling(false);
    }
  }

  async function handleSubmit(values: SubscriptionFormValues) {
    const res = await fetch(`/api/subscriptions/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { error: data?.message ?? "Couldn't save your changes. Try again." };
    }

    // Financial-consequence feedback, gated strictly to a genuine
    // active-to-canceled transition, not paused (suspended, not actually
    // saved yet) and not any other edit. A subscription's own already-
    // persisted amount/currency/billingCycle at the moment of *this* save
    // is unambiguous here, unlike the delete flow below where the same
    // action could just as easily be correcting a duplicate/data-entry
    // mistake rather than a real cancellation. See handleDelete's own
    // comment for why that one stays a neutral toast.
    if (subscription.status === "active" && values.status === "canceled") {
      const annual = annualCents(amountStringToCents(values.amount), values.billingCycle);
      toast.success("Canceled", {
        description: `You'll save about ${formatCents(annual, values.currency)}/year.`,
      });
    } else {
      toast.success("Changes saved");
    }
    router.push("/dashboard");
    router.refresh();
    return {};
  }

  // Deliberately no "you'll save $X/mo" framing here, unlike the
  // active→canceled case above. A delete is genuinely ambiguous about
  // whether real-world spend actually changed (it could just as easily be
  // removing a duplicate row or fixing a data-entry mistake as ending a
  // real subscription), and claiming a saving that may not be true would
  // violate this app's own "never fabricate a number" rule. "Subscription
  // deleted" states only what actually happened.
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete that subscription. Try again.");
        return;
      }
      toast.success("Subscription deleted");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Couldn't delete that subscription. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <SubscriptionForm
        initialValues={subscriptionToFormValues(subscription)}
        showStatus
        submitLabel="Save changes"
        onSubmit={handleSubmit}
      />
      {/* Only while still active: once status is already paused/canceled
          here, the user has presumably already dealt with the real-world
          side of it (or never needs to; this is the moment that decision
          is actually being made). Every "review this subscription" path in
          the app (Savings, Quick wins, the renewal-reminder email) lands
          here, and until now none of them offered anything beyond editing
          this app's own record of it. SubSentry has no cancellation
          integration with any merchant, so a real, honest search link is
          the most useful thing this screen can offer instead of nothing. */}
      {subscription.status === "active" ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">Canceling {subscription.name}?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            SubSentry only tracks what you tell it; it can&apos;t cancel this for you. Marking it canceled here just
            updates your own record; you&apos;ll still need to cancel with {subscription.name} directly to actually
            stop being charged.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleQuickCancel} disabled={canceling}>
              {canceling ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Check className="size-3.5" aria-hidden="true" />
              )}
              Mark as canceled
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<a href={cancelSearchUrl(subscription.name)} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Search how to cancel {subscription.name}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <p className="text-sm font-medium">Danger zone</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleting a subscription removes it and its history permanently.
        </p>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" className="mt-3" />}>
            Delete subscription
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {subscription.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {/* Deliberately no mention of "Money saved so far" here,
                    even for an already-canceled subscription — unlike this
                    dialog's old copy. That total now reads from the
                    persisted realizedSavings ledger (schema.ts), written
                    once at the moment of cancellation, not from this row's
                    own current state — deleting a subscription (canceled or
                    not) no longer changes it, so saying otherwise would be
                    stale, false guidance now. */}
                This removes it and its history permanently. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
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
      </div>
    </div>
  );
}
