import type { Subscription } from "@/lib/db/schema";

let nextId = 1;
export function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: `sub-${nextId++}`,
    userId: "user-1",
    name: "Test Sub",
    amountCents: 999,
    currency: "usd",
    billingCycle: "monthly",
    category: "other",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}
