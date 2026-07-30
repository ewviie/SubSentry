"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCents } from "@/lib/subscriptions/money";
import { BILLING_CYCLE_LABELS, CATEGORY_LABELS, STATUS_LABELS } from "@/lib/subscriptions/labels";
import { CATEGORY_BADGE_CLASSES } from "@/lib/subscriptions/category-colors";
import type { Subscription } from "@/lib/db/schema";

export function SubscriptionsTable({ subscriptions }: { subscriptions: Subscription[] }) {
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
    <Table className="mt-6">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Next renewal</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <AnimatePresence initial={false}>
          {subscriptions.map((s) => (
            <motion.tr
              key={s.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 data-[state=selected]:bg-muted"
            >
              <TableCell className="p-0">
                <Link href={`/subscriptions/${s.id}`} className="block px-2 py-2 font-medium">
                  {s.name}
                </Link>
              </TableCell>
              <TableCell className="font-mono">
                {formatCents(s.amountCents, s.currency)}
                <span className="text-muted-foreground"> / {BILLING_CYCLE_LABELS[s.billingCycle]}</span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className={CATEGORY_BADGE_CLASSES[s.category]}>
                  {CATEGORY_LABELS[s.category]}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{s.nextRenewalDate}</TableCell>
              <TableCell>
                <Badge variant={s.status === "active" ? "default" : "secondary"}>
                  {STATUS_LABELS[s.status]}
                </Badge>
              </TableCell>
            </motion.tr>
          ))}
        </AnimatePresence>
      </TableBody>
    </Table>
  );
}
