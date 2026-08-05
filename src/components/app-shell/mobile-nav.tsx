"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, isNavItemActive, type NavItem } from "@/components/app-shell/nav-items";

// Left-side drawer on the same base-ui Dialog primitive as ui/dialog.tsx
// (focus trap, Esc-to-close, aria dialog semantics for free) rather than a
// hand-rolled panel. Fills a real gap in the previous shell: PrimaryNav was
// `hidden sm:flex` with no fallback, so below that width there was no way
// to navigate at all besides the logo link back to /dashboard.
export function MobileNav() {
  const pathname = usePathname();

  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger render={<Button variant="ghost" size="icon-sm" aria-label="Open navigation" />}>
        <Menu className="size-4.5" aria-hidden="true" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background ring-1 ring-foreground/10 duration-150 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
            <span className="font-heading text-base font-semibold">Menu</span>
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close navigation" />}>
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {NAV_ITEMS.map((item) => (
              <MobileLink key={item.href} item={item} active={isNavItemActive(pathname, item.href)} />
            ))}
          </nav>
          <nav aria-label="Secondary" className="space-y-1 border-t border-border/60 px-3 py-3">
            {SECONDARY_NAV_ITEMS.map((item) => (
              <MobileLink key={item.href} item={item} active={isNavItemActive(pathname, item.href)} />
            ))}
          </nav>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MobileLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <DialogPrimitive.Close
      render={
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
            active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        />
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {item.label}
    </DialogPrimitive.Close>
  );
}
