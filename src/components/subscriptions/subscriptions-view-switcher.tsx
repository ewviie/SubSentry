"use client";

import { useState } from "react";
import { List, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubscriptionsExplorer } from "@/components/subscriptions/subscriptions-explorer";
import { RenewalCalendarView } from "@/components/subscriptions/renewal-calendar-view";
import type { Subscription } from "@/lib/db/schema";
import type { ComputedInsight } from "@/lib/subscriptions/insights";

// Local component state, not a URL param or a stored preference — both
// views read the exact same already-fetched subscriptions list (no
// separate request on switch), so there's nothing here worth surviving a
// reload or being shareable as a link; a plain toggle is the right amount
// of persistence for "which of two views am I looking at right now."
export function SubscriptionsViewSwitcher({
  subscriptions,
  insights,
}: {
  subscriptions: Subscription[];
  insights: ComputedInsight[];
}) {
  const [view, setView] = useState<"list" | "calendar">("list");

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        <Button
          type="button"
          variant={view === "list" ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          <List className="size-3.5" aria-hidden="true" />
          List
        </Button>
        <Button
          type="button"
          variant={view === "calendar" ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={view === "calendar"}
          onClick={() => setView("calendar")}
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          Renewals
        </Button>
      </div>
      {view === "list" ? (
        <SubscriptionsExplorer subscriptions={subscriptions} insights={insights} />
      ) : (
        <RenewalCalendarView subscriptions={subscriptions} />
      )}
    </div>
  );
}
