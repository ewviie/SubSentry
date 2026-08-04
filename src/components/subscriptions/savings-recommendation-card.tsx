import Link from "next/link";
import { Copy, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import type { SavingsRecommendation } from "@/lib/subscriptions/savings";

const TYPE_ICON = { duplicate: Copy, category_concentration: Layers } as const;

export function SavingsRecommendationCard({ recommendation }: { recommendation: SavingsRecommendation }) {
  const Icon = TYPE_ICON[recommendation.type];
  const hasSavings = recommendation.monthlySavingsCents > 0;

  return (
    <Card className={hasSavings ? "border-gold/30 shadow-elevation-low ring-1 ring-gold/10" : "shadow-elevation-low"}>
      <CardContent className="flex items-start gap-4">
        <div
          className={
            hasSavings
              ? "flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-muted text-gold"
              : "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          }
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{recommendation.title}</p>
            {hasSavings ? (
              <Badge className="bg-gold text-gold-foreground">
                {formatCents(recommendation.monthlySavingsCents)}/mo
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{recommendation.description}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            render={<Link href={`/subscriptions/${recommendation.targetSubscriptionId}`} />}
            nativeButton={false}
          >
            {recommendation.actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
