import { cn } from "@/lib/utils";

// The brand's signature motif: a quiet sonar-style ring radiating outward,
// standing in for "a sentry watching" — one slow, low-opacity pulse rather
// than a busy rotating radar sweep, so it reads as a considered detail
// tucked behind the brand mark rather than as decoration competing for
// attention. Pure CSS (not Framer Motion) since it's a passive ambient
// loop, not a triggered interaction — `motion-reduce:` on the pulse layer
// covers the reduced-motion case that Framer's reducedMotion="user" config
// doesn't reach.
export function SentryRing({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -inset-2 rounded-full",
        "before:absolute before:inset-0 before:rounded-full before:border before:border-emerald/25 before:content-['']",
        "after:absolute after:inset-0 after:animate-ping after:rounded-full after:border after:border-emerald/30 after:![animation-duration:2.8s] after:motion-reduce:hidden after:content-['']",
        className
      )}
    />
  );
}
