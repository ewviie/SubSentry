"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { Subscription } from "@/lib/db/schema";

export function RenewalsList({ renewals }: { renewals: Subscription[] }) {
  if (renewals.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing renewing in the next 30 days.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      <AnimatePresence initial={false}>
        {renewals.map((s) => (
          <motion.li
            key={s.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-between py-2 text-sm"
          >
            <Link href={`/subscriptions/${s.id}`} className="font-medium hover:underline">
              {s.name}
            </Link>
            <span className="text-muted-foreground">{s.nextRenewalDate}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
