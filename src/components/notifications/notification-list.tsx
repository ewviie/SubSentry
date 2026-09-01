"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import { cn, formatRelativeTime } from "@/lib/utils";
import { NOTIFICATION_TYPE_ICON } from "./type-icon";
import type { Notification } from "@/lib/db/schema";

// The full /notifications page's list — server-rendered initial data
// (notifications/page.tsx), read/unread state managed client-side from
// there on, same optimistic-then-fire-the-request pattern
// notification-bell.tsx's own dropdown uses (the two intentionally don't
// share one component: the bell's is a compact dropdown row, this is a
// fuller page row with more breathing room — but both hit the same
// /api/notifications/[id]/read endpoint).
export function NotificationList({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [items, setItems] = useState(initialNotifications);
  const unreadCount = items.filter((n) => !n.readAt).length;

  function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date() } : n)));
    fetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }

  function markAllRead() {
    const now = new Date();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {items.map((item) => (
          <NotificationRow key={item.id} item={item} onMarkRead={() => markRead(item.id)} />
        ))}
      </ul>
    </div>
  );
}

function NotificationRow({ item, onMarkRead }: { item: Notification; onMarkRead: () => void }) {
  const Icon = NOTIFICATION_TYPE_ICON[item.type];
  const unread = !item.readAt;

  const inner = (
    <div className={cn("flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50", unread && "bg-emerald-muted/20")}>
      <div
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
          item.severity === "warning" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", unread ? "font-medium text-foreground" : "text-muted-foreground")}>{item.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatRelativeTime(new Date(item.createdAt))}</span>
          {item.impactCents !== null && item.currency ? (
            <span className="font-financial font-medium text-foreground">{formatCents(item.impactCents, item.currency)}</span>
          ) : null}
        </div>
      </div>
      {unread ? <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-emerald" /> : null}
    </div>
  );

  if (!item.actionHref) {
    return (
      <li>
        <button type="button" onClick={onMarkRead} className="block w-full text-left">
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li>
      <Link href={item.actionHref as Route} onClick={onMarkRead} className="block">
        {inner}
      </Link>
    </li>
  );
}
