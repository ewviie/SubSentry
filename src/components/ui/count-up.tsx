"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { formatCents } from "@/lib/subscriptions/money";

// `format` takes a variant tag rather than a formatter function — this
// component is a Client Component and Server Components (dashboard/page.tsx)
// can't pass functions across the RSC boundary as props.
export function CountUp({
  value,
  format,
  currency = "usd",
  duration = 0.6,
}: {
  value: number;
  format: "currency" | "integer";
  currency?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  // Tracks the actually-displayed value (updated every animation frame),
  // not just the previous target — if `value` changes again while an
  // animation is still in flight, the next one must start from wherever the
  // number visually is, not from a target it never finished reaching.
  const displayedValue = useRef(0);

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
