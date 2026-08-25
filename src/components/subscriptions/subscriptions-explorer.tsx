"use client";

import { startTransition, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Inbox, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SubscriptionRow } from "@/components/subscriptions/subscription-row";
import { BulkActionBar } from "@/components/subscriptions/bulk-action-bar";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/subscriptions/labels";
import { CATEGORIES, STATUSES } from "@/lib/subscriptions/validation";
import { formatCents, monthlyCents } from "@/lib/subscriptions/money";
import {
  daysUntilRenewal,
  getDuplicateFlaggedIds,
  getHighCostFlaggedIds,
  getNeedsReviewIds,
  isRecentlyAdded,
  isUpcomingRenewal,
} from "@/lib/subscriptions/filters";
import { revealViewport, staggerContainer } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Subscription } from "@/lib/db/schema";
import type { ComputedInsight } from "@/lib/subscriptions/insights";

type QuickFilter = "needs_review" | "duplicate" | "high_cost" | "recently_added" | "upcoming_renewal";

const QUICK_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: "needs_review", label: "Needs review" },
  { value: "duplicate", label: "Duplicate" },
  { value: "high_cost", label: "High cost" },
  { value: "recently_added", label: "Recently added" },
  { value: "upcoming_renewal", label: "Upcoming renewal" },
];

type SortKey = "renewal" | "name" | "amount_desc" | "recently_added";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "renewal", label: "Next renewal" },
  { value: "amount_desc", label: "Highest cost" },
  { value: "name", label: "Name (A–Z)" },
  { value: "recently_added", label: "Recently added" },
];

// Drives useOptimistic below: applied synchronously the instant a bulk
// action starts, before either PATCH/DELETE request has actually reached
// the server, so status changes/removals are visible immediately instead
// of only after bulkChangeStatus/bulkDelete's router.refresh() lands. If
// any of the underlying requests fail, this optimistic state is discarded
// automatically once router.refresh() re-renders with the real
// (unchanged, for the failed ids) `subscriptions` prop. useOptimistic's
// own reconciliation, not manual rollback code here.
type OptimisticSubscriptionsAction =
  | { type: "status"; ids: string[]; status: Subscription["status"] }
  | { type: "delete"; ids: string[] };

function optimisticSubscriptionsReducer(
  state: Subscription[],
  action: OptimisticSubscriptionsAction,
): Subscription[] {
  switch (action.type) {
    case "status": {
      const ids = new Set(action.ids);
      return state.map((s) => (ids.has(s.id) ? { ...s, status: action.status } : s));
    }
    case "delete": {
      const ids = new Set(action.ids);
      return state.filter((s) => !ids.has(s.id));
    }
  }
}

export function SubscriptionsExplorer({
  subscriptions,
  insights,
}: {
  subscriptions: Subscription[];
  insights: ComputedInsight[];
}) {
  const router = useRouter();
  const [visibleSubscriptions, applyOptimisticUpdate] = useOptimistic(
    subscriptions,
    optimisticSubscriptionsReducer,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Subscription["status"] | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<Subscription["category"] | "all">("all");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());
  const [sort, setSort] = useState<SortKey>("renewal");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const hadSelectionRef = useRef(false);

  // BulkActionBar (and whatever inside it currently has focus, the
  // triggering "Delete"/"Archive" button, or the alert dialog's confirm
  // button once it closes) unmounts the instant selectedIds empties out,
  // whether that's a successful bulk action or the bar's own "Clear
  // selection" button. Left alone, focus silently drops to <body>. This
  // effect only fires on the >0 -> 0 transition (not on initial mount or
  // while selection is growing), then re-anchors focus on the one element
  // in this tree that's guaranteed to still exist afterward.
  useEffect(() => {
    if (selectedIds.size === 0 && hadSelectionRef.current) {
      statusRef.current?.focus();
    }
    hadSelectionRef.current = selectedIds.size > 0;
  }, [selectedIds]);

  const duplicateIds = useMemo(() => getDuplicateFlaggedIds(insights), [insights]);
  const highCostIds = useMemo(() => getHighCostFlaggedIds(insights), [insights]);
  const needsReviewIds = useMemo(() => getNeedsReviewIds(insights), [insights]);

  // Quick filters OR together, not AND: selecting more than one (e.g.
  // "Needs review" + "Duplicate") should widen what's shown ("anything
  // worth a look"), not narrow it to only rows matching every selected
  // criterion simultaneously. AND was the original behavior here, and it
  // silently produced an empty "No matches" the moment two selected
  // filters' id sets didn't fully overlap: e.g. two subscriptions flagged
  // "needs review" for being overdue, but not flagged "duplicate" of each
  // other, made "Needs review" + "Duplicate" together show 0 results even
  // though 2 real, relevant subscriptions existed. search/status/category
  // stay AND'd with quick filters and with each other: those are narrowing
  // a list by construction (a search term, one status, one category), not a
  // multi-select "highlight anything relevant" control.
  const filtered = useMemo(() => {
    function matchesQuickFilter(s: Subscription, filter: QuickFilter): boolean {
      switch (filter) {
        case "needs_review":
          return needsReviewIds.has(s.id);
        case "duplicate":
          return duplicateIds.has(s.id);
        case "high_cost":
          return highCostIds.has(s.id);
        case "recently_added":
          return isRecentlyAdded(s);
        case "upcoming_renewal":
          return isUpcomingRenewal(s);
      }
    }

    const query = search.trim().toLowerCase();
    return visibleSubscriptions.filter((s) => {
      if (query && !s.name.toLowerCase().includes(query)) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      if (quickFilters.size > 0 && ![...quickFilters].some((filter) => matchesQuickFilter(s, filter))) return false;
      return true;
    });
  }, [
    visibleSubscriptions,
    search,
    statusFilter,
    categoryFilter,
    quickFilters,
    needsReviewIds,
    duplicateIds,
    highCostIds,
  ]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sort) {
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "amount_desc":
        return list.sort(
          (a, b) => monthlyCents(b.amountCents, b.billingCycle) - monthlyCents(a.amountCents, a.billingCycle),
        );
      case "recently_added":
        return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      case "renewal":
      default:
        return list.sort((a, b) => daysUntilRenewal(a) - daysUntilRenewal(b));
    }
  }, [filtered, sort]);

  function toggleQuickFilter(filter: QuickFilter) {
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setQuickFilters(new Set());
  }

  async function bulkChangeStatus(status: Subscription["status"]) {
    setBusy(true);
    const ids = [...selectedIds];
    // Snapshotted before the PATCH calls land, so the savings figure below
    // reflects what was actually active at the moment of this action, not
    // whatever visibleSubscriptions has become by the time the toast reads it.
    const targeted = visibleSubscriptions.filter((s) => selectedIds.has(s.id));
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/subscriptions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }).then((res) => {
          if (!res.ok) throw new Error("failed");
        }),
      ),
    );
    const failedIds = ids.filter((_, i) => results[i].status === "rejected");
    if (failedIds.length > 0) {
      toast.error(`Updated ${ids.length - failedIds.length} of ${ids.length}. ${failedIds.length} failed. Try again.`);
    } else if (status === "canceled") {
      // Same financial-consequence framing (and the same active-only,
      // single-currency-or-null honesty rule) EditSubscriptionForm's own
      // active→canceled toast already uses. This is the bulk path that
      // skipped it, landing users on a generic "N updated" for the one
      // action in this app that's actually supposed to feel like progress.
      const canceledNow = targeted.filter((s) => s.status === "active");
      const currency = canceledNow[0]?.currency.toLowerCase();
      const singleCurrency = canceledNow.length > 0 && canceledNow.every((s) => s.currency.toLowerCase() === currency);
      const savingsMonthlyCents = singleCurrency
        ? canceledNow.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0)
        : 0;
      toast.success(`${ids.length} subscription${ids.length === 1 ? "" : "s"} canceled`, {
        description: savingsMonthlyCents > 0 ? `You'll save ${formatCents(savingsMonthlyCents, currency)}/mo.` : undefined,
      });
    } else {
      toast.success(`${ids.length} subscription${ids.length === 1 ? "" : "s"} updated`);
    }
    // Keep only the failed items selected: clearing the whole selection
    // would force the user to manually find and reselect them before the
    // "Try again" the toast just told them to do.
    setSelectedIds(new Set(failedIds));
    setBusy(false);
    router.refresh();
  }

  async function bulkDelete() {
    setBusy(true);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/subscriptions/${id}`, { method: "DELETE" }).then((res) => {
        if (!res.ok) throw new Error("failed");
      })),
    );
    const failedIds = ids.filter((_, i) => results[i].status === "rejected");
    if (failedIds.length > 0) {
      toast.error(`Deleted ${ids.length - failedIds.length} of ${ids.length}. ${failedIds.length} failed. Try again.`);
    } else {
      toast.success(`${ids.length} subscription${ids.length === 1 ? "" : "s"} deleted`);
    }
    setSelectedIds(new Set(failedIds));
    setBusy(false);
    router.refresh();
  }

  const hasActiveFilters =
    search.trim() !== "" || statusFilter !== "all" || categoryFilter !== "all" || quickFilters.size > 0;

  if (visibleSubscriptions.length === 0) {
    return (
      <EmptyState
        className="mt-8"
        icon={Inbox}
        title="No subscriptions yet"
        description="Add your first one to start tracking what you pay for."
        action={
          <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
            Add subscription
          </Button>
        }
      />
    );
  }

  return (
    // pb-24: same fix review-table.tsx's root already has for the exact
    // same fixed-bottom-pill pattern (BulkActionBar here, ReviewActionBar
    // there): without it, selecting a row near the end of this list puts
    // the floating pill directly over the last row(s) and their checkboxes,
    // on any viewport short enough that the list runs to the bottom.
    <div className="pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subscriptions…"
            className="pl-9"
            aria-label="Search subscriptions"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as typeof categoryFilter)}>
            <SelectTrigger aria-label="Filter by category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger aria-label="Sort by">
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => {
          const active = quickFilters.has(filter.value);
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => toggleQuickFilter(filter.value)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p
          ref={statusRef}
          tabIndex={-1}
          className="text-sm text-muted-foreground outline-none"
          role="status"
          aria-live="polite"
        >
          {sorted.length} of {visibleSubscriptions.length} subscription{visibleSubscriptions.length === 1 ? "" : "s"}
        </p>
        {sorted.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={sorted.every((s) => selectedIds.has(s.id))}
              indeterminate={
                !sorted.every((s) => selectedIds.has(s.id)) && sorted.some((s) => selectedIds.has(s.id))
              }
              onCheckedChange={(checked) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (checked) sorted.forEach((s) => next.add(s.id));
                  else sorted.forEach((s) => next.delete(s.id));
                  return next;
                });
              }}
              aria-label="Select all visible subscriptions"
            />
            Select all
          </label>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={Search}
          title="No matches"
          description="Nothing matches your search and filters."
          action={
            hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <motion.ul
          variants={staggerContainer(0.04)}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="mt-4 space-y-2"
        >
          {sorted.map((subscription) => (
            <SubscriptionRow
              key={subscription.id}
              subscription={subscription}
              selected={selectedIds.has(subscription.id)}
              onToggleSelected={toggleSelected}
              isDuplicate={duplicateIds.has(subscription.id)}
              isHighCost={highCostIds.has(subscription.id)}
            />
          ))}
        </motion.ul>
      )}

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        onChangeStatus={bulkChangeStatus}
        onDelete={bulkDelete}
        busy={busy}
      />
    </div>
  );
}
