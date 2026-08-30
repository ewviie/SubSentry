"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatCents } from "@/lib/subscriptions/money";

// `format` takes a variant tag rather than a formatter function: this
// component is a Client Component and Server Components (dashboard/page.tsx)
// can't pass functions across the RSC boundary as props.
export function CountUp({
  value,
  format,
  currency = "usd",
  duration = 0.6,
  animateOnMount = true,
}: {
  value: number;
  format: "currency" | "integer";
  currency?: string;
  duration?: number;
  // Launch-readiness audit: every mount used to start `display`/
  // `displayedValue` at a hardcoded 0, so the server-rendered HTML — before
  // any client JS runs — literally showed "$0.00"/"0"/"0/100" regardless of
  // whether the real value was already known. Defaults to `true` (the
  // original, unchanged behavior) because that animate-from-zero-on-mount
  // is a deliberate reveal effect at this component's other call sites
  // (the landing hero's entrance animation, the import wizard's "counting
  // as it calculates" moment in reveal-step.tsx) — this prop is opt-out,
  // not a global behavior change. The dashboard's real financial numbers
  // (OverviewPanel, HealthScoreGauge) pass `false`: those are the one place
  // a first-paint "$0.00"/"0/100" reads as a wrong number on a fintech app,
  // not a flourish.
  animateOnMount?: boolean;
}) {
  const initial = animateOnMount ? 0 : value;
  const [display, setDisplay] = useState(initial);
  const prefersReducedMotion = useReducedMotion();
  // Tracks the actually-displayed value (updated every animation frame),
  // not just the previous target: if `value` changes again while an
  // animation is still in flight, the next one must start from wherever the
  // number visually is, not from a target it never finished reaching.
  // Seeded from the same `initial` as `display` above: when
  // `animateOnMount` is false, this makes the mount-time effect run below
  // see `from === value` immediately and take its existing no-op branch —
  // no separate "skip the animation" code path needed.
  const displayedValue = useRef(initial);

  useEffect(() => {
    const from = displayedValue.current;

    if (prefersReducedMotion || from === value) {
      displayedValue.current = value;
      setDisplay(value);
      return;
    }

    const controls = animate(from, value, {
      duration,
      ease: "easeOut",
      onUpdate: (latest) => {
        displayedValue.current = latest;
        setDisplay(latest);
      },
    });
    return () => controls.stop();
  }, [value, duration, prefersReducedMotion]);

  const rounded = Math.round(display);
  return <>{format === "currency" ? formatCents(rounded, currency) : rounded}</>;
}
