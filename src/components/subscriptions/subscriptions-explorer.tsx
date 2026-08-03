"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { monthlyCents } from "@/lib/subscriptions/money";
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

export function SubscriptionsExplorer({
  subscriptions,
  insights,
}: {
  subscriptions: Subscription[];
  insights: ComputedInsight[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Subscription["status"] | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<Subscription["category"] | "all">("all");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilter>>(new Set());
  const [sort, setSort] = useState<SortKey>("renewal");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const hadSelectionRef = useRef(false);

  // BulkActionBar (and whatever inside it currently has focus — the
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (query && !s.name.toLowerCase().includes(query)) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      for (const filter of quickFilters) {
        if (filter === "needs_review" && !needsReviewIds.has(s.id)) return false;
        if (filter === "duplicate" && !duplicateIds.has(s.id)) return false;
        if (filter === "high_cost" && !highCostIds.has(s.id)) return false;
        if (filter === "recently_added" && !isRecentlyAdded(s)) return false;
        if (filter === "upcoming_renewal" && !isUpcomingRenewal(s)) return false;
      }
      return true;
    });
  }, [subscriptions, search, statusFilter, categoryFilter, quickFilters, needsReviewIds, duplicateIds, highCostIds]);

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
    } else {
      toast.success(`${ids.length} subscription${ids.length === 1 ? "" : "s"} updated`);
    }
    // Keep only the failed items selected — clearing the whole selection
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

  if (subscriptions.length === 0) {
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
    <div>
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
          {sorted.length} of {subscriptions.length} subscription{subscriptions.length === 1 ? "" : "s"}
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
