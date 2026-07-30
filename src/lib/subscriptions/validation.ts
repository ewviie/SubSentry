import { z } from "zod";

export const BILLING_CYCLES = ["monthly", "yearly", "weekly", "quarterly"] as const;
export const CATEGORIES = [
  "streaming",
  "software",
  "fitness",
  "utilities",
  "finance",
  "news",
  "gaming",
  "other",
] as const;
export const STATUSES = ["active", "paused", "canceled"] as const;

// subscriptions.amount_cents is a Postgres `integer` (max 2,147,483,647), so
// an amount above this turns valid-looking input into a failed insert.
const MAX_AMOUNT = 21_474_836.47;

// The regex only checks YYYY-MM-DD shape — 2026-02-31 would pass it and then
// get rejected by Postgres's `date` column at insert/update time. Round-trip
// through Date.UTC to catch calendar-invalid dates before they reach the DB.
function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const subscriptionInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount, e.g. 15.99")
    .refine((value) => Number(value) <= MAX_AMOUNT, "Amount is too large"),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Enter a valid 3-letter currency code")
    .default("usd"),
  billingCycle: z.enum(BILLING_CYCLES),
  category: z.enum(CATEGORIES).default("other"),
  nextRenewalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .refine(isValidCalendarDate, "Enter a valid calendar date"),
  status: z.enum(STATUSES).default("active"),
  notes: z.string().trim().max(2000).optional(),
});

export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;
export const subscriptionUpdateSchema = subscriptionInputSchema.partial();
export type SubscriptionUpdate = z.infer<typeof subscriptionUpdateSchema>;
