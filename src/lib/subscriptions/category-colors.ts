import type { Subscription } from "@/lib/db/schema";

// Reuses the same chart-N / gold tokens the dashboard's category breakdown
// already draws from, plus the muted/secondary pairing insights-section.tsx
// already uses for its icon chips — no new color tokens introduced.
export const CATEGORY_BADGE_CLASSES: Record<Subscription["category"], string> = {
  streaming: "bg-chart-2/10 text-chart-2",
  software: "bg-chart-3/10 text-chart-3",
  fitness: "bg-chart-4/10 text-chart-4",
  utilities: "bg-chart-5/10 text-chart-5",
  finance: "bg-gold-muted text-gold",
  news: "bg-chart-1/10 text-chart-1",
  gaming: "bg-chart-2/10 text-chart-2",
  other: "bg-muted text-muted-foreground",
};
