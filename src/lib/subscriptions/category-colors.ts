import {
  Clapperboard,
  AppWindow,
  Dumbbell,
  Zap,
  Landmark,
  Newspaper,
  Gamepad2,
  Package,
  type LucideIcon,
} from "lucide-react";
import type { Subscription } from "@/lib/db/schema";

// Reuses the same chart-N / emerald tokens the dashboard's category breakdown
// already draws from, plus the muted/secondary pairing insights-section.tsx
// already uses for its icon chips. chart-6 was added specifically so gaming
// no longer collides with streaming — 8 categories need 8 distinct colors
// and the original chart-1..5 + emerald + muted set only covered 7.
export const CATEGORY_BADGE_CLASSES: Record<Subscription["category"], string> = {
  streaming: "bg-chart-2/10 text-chart-2",
  software: "bg-chart-3/10 text-chart-3",
  fitness: "bg-chart-4/10 text-chart-4",
  utilities: "bg-chart-5/10 text-chart-5",
  finance: "bg-emerald-muted text-emerald",
  news: "bg-chart-1/10 text-chart-1",
  gaming: "bg-chart-6/10 text-chart-6",
  other: "bg-muted text-muted-foreground",
};

// Same category → token assignment as CATEGORY_BADGE_CLASSES above, as a
// solid fill instead of a muted wash — for chart/bar contexts where a faint
// tint wouldn't read against the track behind it.
export const CATEGORY_BAR_CLASSES: Record<Subscription["category"], string> = {
  streaming: "bg-chart-2",
  software: "bg-chart-3",
  fitness: "bg-chart-4",
  utilities: "bg-chart-5",
  finance: "bg-emerald",
  news: "bg-chart-1",
  gaming: "bg-chart-6",
  other: "bg-muted-foreground",
};

// Stands in for a real merchant logo, which we don't have — no logo field
// exists on the subscription record, and fetching one from a third-party
// favicon service would mean sending subscription names off to an external
// API without asking first. A category icon is an honest, zero-dependency
// substitute rather than a fabricated brand mark.
export const CATEGORY_ICONS: Record<Subscription["category"], LucideIcon> = {
  streaming: Clapperboard,
  software: AppWindow,
  fitness: Dumbbell,
  utilities: Zap,
  finance: Landmark,
  news: Newspaper,
  gaming: Gamepad2,
  other: Package,
};
