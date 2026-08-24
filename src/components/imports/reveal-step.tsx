"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { Search, PiggyBank, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { SentryRing } from "@/components/ui/sentry-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { springSmooth } from "@/lib/motion";
import { monthlyCents, annualCents, splitByPrimaryCurrency } from "@/lib/subscriptions/money";
import { cn } from "@/lib/utils";
import type { DetectedSubscription } from "@/lib/imports/types";

// The actual sequence this earns: data arrived → SubSentry looked through
// it → specific things were found (named, one at a time — not a total
// dropped on screen) → what they cost monthly → what that really is once
// annualized (the same CountUp instance re-targeted, not two separate
// numbers — the counter continuing from where it left off IS the "this
// monthly amount becomes this yearly amount" statement). No new chrome:
// same card, same typography scale, same tokens as the rest of the wizard.
// Ghost-pill → resolved-pill is the same "unresolved becomes real" move
// hero-section.tsx's GhostCharges already uses on the marketing page —
// reused on purpose, so it reads as a SubSentry technique, not a one-off.
type Phase = "searching" | "discovering" | "monthly" | "yearly";

const MERCHANT_STAGGER_MS = 260;
const SEARCH_MS = 650;
const POST_DISCOVERY_PAUSE_MS = 450;
const MONTHLY_HOLD_MS = 900;
const SPRING: Transition = springSmooth;
// Same cap AllSubscriptionsList already uses for its dashboard preview —
// reusing that number rather than picking a new one. Past it, individually
// staggering every merchant would make the sequence drag for exactly the
// power users who imported the most (the opposite of who should wait
// longest); the remainder is acknowledged as a group instead.
const MAX_INDIVIDUAL_REVEALS = 6;

export function RevealStep({
  detected,
  onContinue,
}: {
  detected: DetectedSubscription[];
  onContinue: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const merchants = useMemo(() => detected.map((d) => d.merchant.displayName), [detected]);
  const visibleMerchants = useMemo(() => merchants.slice(0, MAX_INDIVIDUAL_REVEALS), [merchants]);
  const hiddenCount = merchants.length - visibleMerchants.length;
  // Restricted to the detected set's primary currency (splitByPrimaryCurrency)
  // — a bank/CSV import can genuinely span currencies, and summing raw
  // cents across them into one total would be fabricated math. totalYearlyCents
  // sums each detected subscription's own exact annual figure directly, not
  // totalMonthlyCents * 12 — see money.ts's own annualCents comment for why
  // that composition double-rounds every yearly/quarterly/weekly one.
  // DetectedSubscription itself carries no top-level currency (same
  // review-table.tsx convention: it's read off the first raw transaction).
  const { currency: revealCurrency, included: primaryDetected } = useMemo(
    () => splitByPrimaryCurrency(detected.map((d) => ({ ...d, currency: d.transactions[0]?.currency ?? "usd" }))),
    [detected],
  );
  const totalMonthlyCents = useMemo(
    () => primaryDetected.reduce((sum, d) => sum + monthlyCents(d.amountCents, d.estimatedBillingCycle.cycle), 0),
    [primaryDetected],
  );
  const totalYearlyCents = useMemo(
    () => primaryDetected.reduce((sum, d) => sum + annualCents(d.amountCents, d.estimatedBillingCycle.cycle), 0),
    [primaryDetected],
  );
  const duplicateCount = useMemo(() => detected.filter((d) => d.isDuplicateOfExistingId).length, [detected]);

  // Always start at the animated defaults, never seeded from
  // prefersReducedMotion directly: framer-motion's hook can resolve *after*
  // first mount (it reads the media query in an effect internally), so a
  // useState initializer reading it would sometimes capture a stale
  // "false" and lock in the wrong starting phase for good — this bit
  // GhostCharges' simpler (render-time-only) reduced-motion check wouldn't
  // have caught, since this component's state persists across renders in a
  // way that one didn't need to. Reduced motion is instead an effect
  // dependency below, so it's re-evaluated whenever it actually resolves.
  const [phase, setPhase] = useState<Phase>("searching");
  const [revealedCount, setRevealedCount] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (prefersReducedMotion) {
      // Deferred a tick rather than called synchronously in the effect body
      // — react-hooks/set-state-in-effect flags direct setState calls here,
      // same fix import-center-page.tsx's own redirect-handling effect
      // already uses for the same reason.
      queueMicrotask(() => {
        setPhase("yearly");
        setRevealedCount(merchants.length);
      });
      return;
    }
    const schedule = (fn: () => void, delay: number) => {
      timers.current.push(setTimeout(fn, delay));
    };

    let t = SEARCH_MS;
    schedule(() => setPhase("discovering"), t);
    visibleMerchants.forEach((_, i) => {
      // The last visible tick jumps straight to the true total (folding in
      // any merchants beyond MAX_INDIVIDUAL_REVEALS at once) rather than
      // stopping at visibleMerchants.length — nothing found is left
      // uncounted, it's just not each individually staggered.
      const isLastVisible = i === visibleMerchants.length - 1;
      schedule(() => setRevealedCount(isLastVisible ? merchants.length : i + 1), t + i * MERCHANT_STAGGER_MS);
    });
    t += (visibleMerchants.length - 1) * MERCHANT_STAGGER_MS + POST_DISCOVERY_PAUSE_MS;
    schedule(() => setPhase("monthly"), t);
    t += MONTHLY_HOLD_MS;
    schedule(() => setPhase("yearly"), t);

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // merchants is stable for the life of this screen (one analyze result,
    // never refetched in place) — only prefersReducedMotion resolving is a
    // real reason to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReducedMotion]);

  const showTotal = phase === "monthly" || phase === "yearly";
  const isYearly = phase === "yearly";
  // Explicit zero-duration override, not just trusting the root
  // MotionConfig(reducedMotion="user") to cover every animated property —
  // CountUp in this same codebase already doesn't rely on that alone (it
  // checks useReducedMotion() itself), and the one property that mattered
  // here (a fade-in's opacity) isn't a transform, which is what
  // reducedMotion="user" is specifically documented to target.
  const transition: Transition = prefersReducedMotion ? { duration: 0 } : SPRING;

  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <motion.div
        animate={!prefersReducedMotion && phase === "searching" ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={
          !prefersReducedMotion && phase === "searching"
            ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
            : transition
        }
        className="relative flex size-14 items-center justify-center"
      >
        <SentryRing />
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-full transition-colors duration-300",
            showTotal ? "bg-emerald-muted text-emerald" : "bg-ai-muted text-ai",
          )}
        >
          {showTotal ? <PiggyBank className="size-5" aria-hidden="true" /> : <Search className="size-5" aria-hidden="true" />}
        </div>
      </motion.div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {phase === "searching" && "Searching your data…"}
        {phase === "discovering" && `Found ${revealedCount} of ${merchants.length}…`}
        {showTotal && `${merchants.length} recurring charge${merchants.length === 1 ? "" : "s"} found`}
      </p>

      {/* Ghost pill → resolved pill, one at a time. All slots exist from the
          start (so the eventual count is never a surprise pop-in), each one
          just switches from "unresolved" to "named" on its own schedule. */}
      <ul className="flex flex-wrap items-center justify-center gap-2" aria-hidden="true">
        {visibleMerchants.map((name, i) => {
          const resolved = i < revealedCount;
          return (
            <li key={name}>
              <motion.span
                initial={false}
                animate={{ scale: resolved ? [0.94, 1.03, 1] : 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-300",
                  resolved ? "border-border bg-card text-foreground" : "border-transparent",
                )}
              >
                {resolved ? (
                  <>
                    <Check className="size-3 text-emerald" aria-hidden="true" />
                    {name}
                  </>
                ) : (
                  <Skeleton className="h-4 w-16 rounded-full" />
                )}
              </motion.span>
            </li>
          );
        })}
        {hiddenCount > 0 && revealedCount >= merchants.length ? (
          <motion.li
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground"
          >
            +{hiddenCount} more
          </motion.li>
        ) : null}
      </ul>
      <p className="sr-only">Found: {merchants.join(", ")}.</p>

      {/* Reserves its final height from the start (min-h) so the merchant
          pills above don't visibly shift position when this switches from
          empty to populated. */}
      <div className="flex min-h-24 flex-col items-center justify-center gap-1">
        {showTotal ? (
          <>
            <motion.p
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transition}
              className="flex items-baseline justify-center gap-1.5"
            >
              <span className="font-mono text-5xl font-semibold tabular-nums text-emerald">
                <CountUp
                  value={isYearly ? totalYearlyCents : totalMonthlyCents}
                  format="currency"
                  currency={revealCurrency ?? undefined}
                  duration={0.8}
                />
              </span>
              <span className="text-lg text-muted-foreground">{isYearly ? "/yr" : "/mo"}</span>
            </motion.p>
            <motion.p
              key={isYearly ? "yearly-caption" : "monthly-caption"}
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-muted-foreground"
            >
              {isYearly
                ? "That's what these subscriptions actually cost you a year."
                : "Here's what that comes to each month."}
            </motion.p>
          </>
        ) : null}
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: isYearly ? 1 : 0, y: isYearly ? 0 : 8 }}
        transition={transition}
        style={{ pointerEvents: isYearly ? "auto" : "none" }}
        className="flex flex-col items-center gap-2"
      >
        {duplicateCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Including {duplicateCount} possible duplicate{duplicateCount === 1 ? "" : "s"} of something you already track.
          </p>
        ) : null}
        <Button size="lg" onClick={onContinue} tabIndex={isYearly ? 0 : -1}>
          Review details
        </Button>
      </motion.div>
    </div>
  );
}
