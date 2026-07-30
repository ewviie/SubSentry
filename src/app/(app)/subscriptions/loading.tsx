import { Skeleton } from "@/components/ui/skeleton";

export default function SubscriptionsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
