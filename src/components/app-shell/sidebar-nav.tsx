"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, isNavItemActive, type NavItem } from "@/components/app-shell/nav-items";

// Persistent left sidebar, lg+ only. Below that, MobileNav's drawer covers
// the same NAV_ITEMS/SECONDARY_NAV_ITEMS list. Fixed rather than sticky:
// AppLayout offsets <main> by the same width (lg:pl-64) so this never
// scrolls with page content, matching Linear/Stripe-style dashboard shells.
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border/60 bg-background lg:flex">
      <Link
        href="/dashboard"
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60 px-5 font-heading text-lg font-semibold"
      >
        <Image src="/logo-mark.png" alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
        SubSentry
      </Link>
      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.href} item={item} active={isNavItemActive(pathname, item.href)} />
        ))}
      </nav>
      <nav aria-label="Secondary" className="space-y-1 border-t border-border/60 px-3 py-3">
        {SECONDARY_NAV_ITEMS.map((item) => (
          <SidebarLink key={item.href} item={item} active={isNavItemActive(pathname, item.href)} />
        ))}
      </nav>
    </aside>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-nav-active"
          className="absolute inset-0 rounded-md bg-muted"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      ) : null}
      <Icon className="relative size-4 shrink-0" aria-hidden="true" />
      <span className="relative">{item.label}</span>
    </Link>
  );
}
