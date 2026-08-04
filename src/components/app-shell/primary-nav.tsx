"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Sliding active-pill nav, adapted from 21st.dev's "Animated Navigation
// Tabs" pattern (motion layoutId indicator) to real next/link routing
// instead of internal tab state — each item is a distinct page, not a
// panel switch.
const ITEMS: { href: Route; label: string }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/analytics", label: "Analytics" },
  { href: "/savings", label: "Savings" },
];

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="primary-nav-active"
                className="absolute inset-0 rounded-md bg-muted"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            ) : null}
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
