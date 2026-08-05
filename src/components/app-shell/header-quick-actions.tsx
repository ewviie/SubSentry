"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// Hidden on /subscriptions/new itself — that page's own form submit button
// is already labeled "Add subscription", so showing this global shortcut
// there duplicates the exact same action right next to the real one.
export function HeaderQuickActions() {
  const pathname = usePathname();
  if (pathname === "/subscriptions/new") return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="hidden sm:inline-flex"
      render={<Link href="/subscriptions/new" />}
      nativeButton={false}
    >
      <Plus className="size-3.5" aria-hidden="true" />
      Add subscription
    </Button>
  );
}
