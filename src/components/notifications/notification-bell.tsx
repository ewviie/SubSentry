"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import { cn, formatRelativeTime } from "@/lib/utils";
import { NOTIFICATION_TYPE_ICON } from "./type-icon";
import type { Notification } from "@/lib/db/schema";

// Mirrors the server-side Notification row shape (schema.ts), minus the
// Drizzle-specific typing and with createdAt/readAt as the ISO strings
// JSON.stringify actually produces — this component never imports the DB
// schema type directly (a client bundle has no business pulling in
// Drizzle's table definitions for one interface shape).
interface NotificationDTO {
  id: string;
  type: Notification["type"];
  title: string;
  body: string;
  severity: "info" | "warning";
  impactCents: number | null;
  currency: string | null;
  actionHref: string | null;
  readAt: string | null;
  createdAt: string;
}

const MAX_DROPDOWN_ITEMS = 8;

// The one interactive surface every authenticated page carries (rendered
// from HeaderQuickActions' spot in the app shell) — see generate.ts's own
// header comment for what feeds this and dashboard/page.tsx for where
// syncNotifications actually runs. This component only ever reads what's
// already been generated; it never triggers detection itself.
export function NotificationBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationDTO[] | null>(null);
  // Derived, not its own state: "loading" is exactly "the panel is open and
  // the first fetch hasn't resolved yet" — a separate setLoading(true) at
  // the top of the fetch effect below would be a synchronous setState call
  // inside an effect body, the exact anti-pattern react-hooks/set-state-in-effect
  // flags (cascading renders). Computing it from state that's already
  // tracked avoids the extra state variable and the lint violation.
  const loading = open && notifications === null;
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close — a plain custom popover rather than
  // the app's existing DropdownMenu primitive (base-ui's Menu): this is a
  // live feed of navigable rows with their own per-item "mark read" side
  // effect, not a set of discrete commands, and role="menu" semantics
  // (arrow-key item navigation, close-on-any-item-activation) don't
  // actually describe what this is.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Lazy: fetches the real list only the first time the panel opens, not on
  // every render or on mount before the user ever looks — initialUnreadCount
  // (server-rendered, see app-shell layout.tsx) already covers the badge
  // number without needing a client fetch at all until this opens.
  useEffect(() => {
    if (!open || notifications !== null) return;
    let cancelled = false;
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((data: { notifications: NotificationDTO[]; unreadCount: number }) => {
        if (cancelled) return;
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      })
      .catch(() => {
        if (!cancelled) setNotifications([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, notifications]);

  async function handleMarkAllRead() {
    setUnreadCount(0);
    setNotifications((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // Optimistic update stays — a failed mark-all-read is low-stakes (the
      // notification reappears as unread on next real sync at worst), and a
      // console-only failure here matches this app's existing posture for
      // similarly low-stakes optimistic UI (see dismiss-recommendation's
      // own comment in savings-recommendation-card.tsx).
    }
  }

  function handleItemClick(item: NotificationDTO) {
    if (item.readAt) return;
    setUnreadCount((c) => Math.max(0, c - 1));
    setNotifications((prev) => prev?.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
    fetch(`/api/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="size-4" aria-hidden="true" />
      </Button>
      {unreadCount > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}

      {open ? (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <p className="text-sm font-medium">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
            ) : notifications && notifications.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Nothing to flag right now.</p>
            ) : (
              notifications?.slice(0, MAX_DROPDOWN_ITEMS).map((item) => (
                <NotificationItem key={item.id} item={item} onClick={() => handleItemClick(item)} onNavigate={() => setOpen(false)} />
              ))
            )}
          </div>
          <div className="border-t border-border p-2 text-center">
            <Link
              href={"/notifications" as Route}
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationItem({
  item,
  onClick,
  onNavigate,
}: {
  item: NotificationDTO;
  onClick: () => void;
  onNavigate: () => void;
}) {
  const Icon = NOTIFICATION_TYPE_ICON[item.type];
  const unread = !item.readAt;
  const content = (
    <div
      className={cn(
        "flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted",
        unread && "bg-emerald-muted/30",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          item.severity === "warning" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs leading-snug", unread ? "font-medium text-foreground" : "text-muted-foreground")}>{item.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatRelativeTime(new Date(item.createdAt))}</span>
          {item.impactCents !== null && item.currency ? (
            <span className="font-financial">{formatCents(item.impactCents, item.currency)}</span>
          ) : null}
        </div>
      </div>
      {unread ? <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald" /> : null}
    </div>
  );

  if (!item.actionHref) {
    return (
      <button type="button" onClick={onClick} className="block w-full">
        {content}
      </button>
    );
  }
  return (
    <Link
      href={item.actionHref as Route}
      onClick={() => {
        onClick();
        onNavigate();
      }}
      className="block"
    >
      {content}
    </Link>
  );
}
