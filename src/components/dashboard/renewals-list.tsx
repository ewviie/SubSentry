"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { fadeQuick } from "@/lib/motion";
import { formatCents, monthlyCents } from "@/lib/subscriptions/money";
import { RenewalBadge } from "@/components/subscriptions/subscription-row";
import type { Subscription } from "@/lib/db/schema";

export function RenewalsList({ renewals }: { renewals: Subscription[] }) {
  if (renewals.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing renewing in the next 30 days.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      <AnimatePresence initial={false}>
        {renewals.map((s) => {
          // monthlyCents(...), not raw amountCents — a yearly/quarterly/
          // weekly subscription's own stored amount is its per-charge
          // price, not its monthly rate; this is the same normalization
          // subscription-row.tsx already applies right next to this exact
          // RenewalBadge, so the two lists never disagree on what a given
          // subscription "costs" per month.
          const monthly = monthlyCents(s.amountCents, s.billingCycle);
          return (
            <motion.li
              key={s.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeQuick}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <Link href={`/subscriptions/${s.id}`} className="min-w-0 truncate font-medium hover:underline">
                {s.name}
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right font-mono tabular-nums">
                  <p className="font-medium">{formatCents(monthly, s.currency)}/mo</p>
                  <p className="text-xs text-muted-foreground">{formatCents(monthly * 12, s.currency)}/yr</p>
                </div>
                <div className="w-20 text-right">
                  <RenewalBadge subscription={s} />
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
