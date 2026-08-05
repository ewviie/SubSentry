import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCardGridSkeleton } from "@/components/dashboard/stat-card-grid-skeleton";

function SectionHeadingSkeleton() {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-11 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>

      {/* Financial overview */}
      <div className="space-y-6">
        <SectionHeadingSkeleton />
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-36" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-4 pt-6 sm:flex-row sm:gap-5">
              <Skeleton className="size-28 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="mx-auto h-4 w-24 sm:mx-0" />
                <Skeleton className="mx-auto h-5 w-20 sm:mx-0" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="mx-auto h-3 w-3/4 sm:mx-0" />
              </div>
            </CardContent>
          </Card>
        </div>
        <StatCardGridSkeleton />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex gap-3 pt-6">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Subscription management */}
      <div className="space-y-6">
        <SectionHeadingSkeleton />
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Savings opportunities */}
      <div className="space-y-6">
        <SectionHeadingSkeleton />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Analytics */}
      <div className="space-y-6">
        <SectionHeadingSkeleton />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
