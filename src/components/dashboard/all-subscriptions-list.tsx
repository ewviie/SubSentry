"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import type { Subscription } from "@/lib/db/schema";

export function AllSubscriptionsList({ subscriptions }: { subscriptions: Subscription[] }) {
  if (subscriptions.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={Inbox}
        title="No subscriptions yet"
        description="Add your first one to start tracking what you pay for, or try the quick-add bar above."
        action={
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/subscriptions/new" />}
            nativeButton={false}
          >
            Add your first one
          </Button>
        }
      />
    );
  }

  return (
    <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
      <AnimatePresence initial={false}>
        {subscriptions.slice(0, 6).map((s) => (
          <motion.li
            key={s.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Link
              href={`/subscriptions/${s.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted"
            >
              <span className="font-medium">{s.name}</span>
              <span className="font-mono text-muted-foreground">
                {formatCents(s.amountCents, s.currency)}
              </span>
            </Link>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
