import type { Transition, Variants } from "framer-motion";

// The shared motion vocabulary for the app — every section should compose
// these instead of hand-rolling its own duration/easing, so the whole
// product reads as one deliberate motion language rather than a pile of
// per-component guesses.

// Snug spring for reveals: physical enough to feel premium, damped enough
// to avoid a floaty overshoot on a marketing page.
export const springSmooth: Transition = { type: "spring", stiffness: 260, damping: 28, mass: 0.9 };

// Tighter spring for direct-feedback interactions (hover/tap) — snappier
// than springSmooth since it's responding to input, not revealing content.
export const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 };

// Plain (non-spring) fade for list items entering/leaving via AnimatePresence
// — a spring overshoot on an opacity-only exit reads as a glitch, not
// physicality, so this is deliberately a flat duration instead of reusing
// springSmooth/springSnappy.
export const fadeQuick: Transition = { duration: 0.15 };

// Default viewport trigger for scroll reveals: fires once, slightly before
// the element is fully on screen so the motion feels anticipatory, not late.
export const revealViewport = { once: true, margin: "-80px" } as const;

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: springSmooth },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: springSmooth },
};

export function staggerContainer(staggerChildren = 0.08, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren, delayChildren } },
  };
}

// Hover lift: pair with `transition-shadow` in className so the box-shadow
// crossfades via CSS while Framer only drives the transform — animating
// multi-layer box-shadow through Framer's spring solver is janky.
export const liftOnHover = { y: -4 };
export const pressScale = { scale: 0.97 };
