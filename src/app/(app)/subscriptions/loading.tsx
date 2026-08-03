import { Skeleton } from "@/components/ui/skeleton";
import { StatCardGridSkeleton } from "@/components/dashboard/stat-card-grid-skeleton";

export default function SubscriptionsLoading() {
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-11 w-36" />
        <Skeleton className="h-8 w-36" />
      </div>

      <StatCardGridSkeleton className="mt-6" />

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-8 flex-1" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24 rounded-full" />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="mt-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
