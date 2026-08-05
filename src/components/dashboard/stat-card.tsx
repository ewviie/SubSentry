import type { LucideIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MotionCard } from "@/components/dashboard/motion-card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  accentClassName = "bg-muted text-muted-foreground",
  emphasis = false,
  caption,
  children,
}: {
  icon: LucideIcon;
  label: string;
  accentClassName?: string;
  // The one number a user actually opens this page to check gets a
  // visually dominant treatment — a emerald top rule, a larger figure, more
  // breathing room — so it reads first. Everything else stays plain: making
  // every card shout equally is the same as none of them shouting at all.
  emphasis?: boolean;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <MotionCard>
      <Card
        className={cn(
          "relative h-full overflow-hidden shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium",
          emphasis && "shadow-sm ring-foreground/[0.08] before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-emerald before:content-['']",
        )}
      >
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
          <CardAction>
            <div
              aria-hidden="true"
              className={cn(
                "flex items-center justify-center rounded-full",
                emphasis ? "size-9" : "size-8",
                accentClassName,
              )}
            >
              <Icon className={emphasis ? "size-4.5" : "size-4"} />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p
            className={cn(
              "font-mono font-semibold tabular-nums",
              emphasis ? "text-4xl" : "text-2xl",
            )}
          >
            {children}
          </p>
          {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
        </CardContent>
      </Card>
    </MotionCard>
  );
}
