import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// One heading pattern for every top-level dashboard section (Financial
// overview / Subscription management / Savings opportunities / Analytics)
// instead of each section hand-rolling its own h2 markup, so the four read
// as one deliberate hierarchy rather than four slightly different ones.
//
// `eyebrow` is optional and additive: every existing call site keeps
// working unchanged (no eyebrow shown); it exists for sections where a
// short kicker line ("OVERVIEW", "NEXT STEPS") earns a second tier of
// hierarchy above the title, the same eyebrow-over-heading pattern used on
// the marketing pages, reused here rather than reinvented.
//
// `as` follows the same convention CardTitle already established
// (card.tsx): defaults to "h2" for the sub-section case this component was
// originally built for (a dashboard section sitting under the page's own
// h1), and switches to "h1" for a page where this heading *is* the whole
// page's only heading — Analytics and Savings used to hand-roll an
// identical eyebrow+heading+description block for exactly that case (UI
// audit finding #10); they now render it through this component instead.
// The heading/description size classes are keyed off the same prop so
// both call-site shapes keep their pre-existing appearance exactly
// (h1 pages never used text-sm/tracking-tight for this block).
//
// `weight` (UI audit finding #3): every section on the dashboard used to
// get this exact same eyebrow-dot + text-h2 treatment regardless of how
// important it actually was — four identical decorative blocks stacked
// down one page reads as templated repetition, not a hierarchy, and
// crowds out the page's own h1 as the thing that should read as loudest.
// "primary" (the default, unchanged) is for the one section per page that
// should carry that full weight — Financial Overview on the dashboard, and
// the sole heading on a whole page like Analytics/Savings. "secondary" is
// for supporting sections sitting alongside it: no eyebrow line, a
// title one full step down in size (text-base, matching CardTitle's own
// scale one level up — see card.tsx), tighter spacing to the description.
// Same information, same landmark structure, clearly lighter weight.
export function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClassName = "text-muted-foreground",
  action,
  as = "h2",
  weight = "primary",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  action?: React.ReactNode;
  as?: "h1" | "h2";
  weight?: "primary" | "secondary";
}) {
  const Heading = as;
  const isSecondary = weight === "secondary";
  return (
    <div
      className={cn(
        "flex flex-wrap gap-3",
        isSecondary ? "items-center justify-between" : "items-end justify-between gap-4"
      )}
    >
      <div className={isSecondary ? "min-w-0" : "max-w-2xl"}>
        {!isSecondary && eyebrow ? (
          <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/35" />
            {eyebrow}
          </p>
        ) : null}
        <Heading
          className={cn(
            "font-heading flex items-center gap-2 font-semibold",
            isSecondary ? "text-base" : as === "h1" ? "text-h1" : "text-h2 tracking-tight"
          )}
        >
          {Icon ? (
            <Icon className={cn(isSecondary ? "size-4" : "size-4.5", "shrink-0", iconClassName)} aria-hidden="true" />
          ) : null}
          {title}
        </Heading>
        {description ? (
          <p
            className={cn(
              isSecondary ? "mt-0.5 text-sm" : as === "h1" ? "mt-1" : "mt-1.5 text-sm leading-relaxed",
              "text-muted-foreground"
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
