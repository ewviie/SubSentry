import type { Subscription } from "@/lib/db/schema";

export const CATEGORY_LABELS: Record<Subscription["category"], string> = {
  streaming: "Streaming",
  software: "Software",
  fitness: "Fitness",
  utilities: "Utilities",
  finance: "Finance",
  news: "News",
  gaming: "Gaming",
  other: "Other",
};

export const BILLING_CYCLE_LABELS: Record<Subscription["billingCycle"], string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  quarterly: "Quarterly",
  weekly: "Weekly",
};

export const STATUS_LABELS: Record<Subscription["status"], string> = {
  active: "Active",
  paused: "Paused",
  canceled: "Canceled",
};
