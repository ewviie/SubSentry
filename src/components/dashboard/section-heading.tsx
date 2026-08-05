import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// One heading pattern for every top-level dashboard section (Financial
// overview / Subscription management / Savings opportunities / Analytics)
// instead of each section hand-rolling its own h2 markup, so the four read
// as one deliberate hierarchy rather than four slightly different ones.
export function SectionHeading({
  title,
  description,
  icon: Icon,
  iconClassName = "text-muted-foreground",
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-heading flex items-center gap-2 text-h2 font-semibold">
          {Icon ? <Icon className={cn("size-4.5", iconClassName)} aria-hidden="true" /> : null}
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
