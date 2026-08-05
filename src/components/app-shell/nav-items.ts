import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Layers, BarChart3, PiggyBank, Settings } from "lucide-react";

export interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
}

// Shared between SidebarNav (desktop, lg+) and MobileNav (drawer, below lg)
// so the two surfaces can never drift out of sync on what pages exist.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subscriptions", label: "Subscriptions", icon: Layers },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/savings", label: "Savings", icon: PiggyBank },
];

export const SECONDARY_NAV_ITEMS: NavItem[] = [{ href: "/settings", label: "Settings", icon: Settings }];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
