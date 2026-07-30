import type { LucideIcon } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  accentClassName = "bg-muted text-muted-foreground",
  children,
}: {
  icon: LucideIcon;
  label: string;
  accentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="transition-shadow hover:shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
        <CardAction>
          <div
            aria-hidden="true"
            className={cn("flex size-8 items-center justify-center rounded-full", accentClassName)}
          >
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold">{children}</p>
      </CardContent>
    </Card>
  );
}
