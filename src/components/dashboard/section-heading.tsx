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
export function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClassName = "text-muted-foreground",
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/35" />
            {eyebrow}
          </p>
        ) : null}
        <h2 className="font-heading flex items-center gap-2 text-h2 font-semibold tracking-tight">
          {Icon ? <Icon className={cn("size-4.5", iconClassName)} aria-hidden="true" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
