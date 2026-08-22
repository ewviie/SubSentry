import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Shared between dashboard/loading.tsx and subscriptions/loading.tsx — both
// pages render a 2-up StatCard grid (Monthly spend, Active subscriptions),
// so their skeletons should too. Was 4-up; Yearly spend and Potential
// savings were dropped from both pages (redundant with Monthly's own
// caption, and with /savings), leaving 2 real cards on each.
export function StatCardGridSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} size="sm">
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
