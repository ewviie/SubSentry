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

// No .default() on any field here — those only belong on the create schema
// below. Zod applies a field's .default() whenever that key is undefined,
// including when .partial() makes the field optional and a caller omits it
// entirely — so a schema built by calling .partial() on a defaulted schema
// silently re-fills omitted fields with their default instead of leaving
// them untouched, corrupting real data on any true partial update (e.g. a
// status-only PATCH would silently reset category back to "other").
const baseFields = {
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
    .regex(/^[a-z]{3}$/, "Enter a valid 3-letter currency code"),
  billingCycle: z.enum(BILLING_CYCLES),
  category: z.enum(CATEGORIES),
  nextRenewalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .refine(isValidCalendarDate, "Enter a valid calendar date"),
  status: z.enum(STATUSES),
  notes: z.string().trim().max(2000).optional(),
};

export const subscriptionInputSchema = z.object(baseFields).extend({
  currency: baseFields.currency.default("usd"),
  category: baseFields.category.default("other"),
  status: baseFields.status.default("active"),
});

export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;
export const subscriptionUpdateSchema = z.object(baseFields).partial();
export type SubscriptionUpdate = z.infer<typeof subscriptionUpdateSchema>;

// subscriptions.id is a Postgres `uuid` column — a malformed string (or
// anything that isn't a UUID at all) makes the driver throw "invalid input
// syntax for type uuid" instead of the query just matching zero rows. Every
// /api/subscriptions/[id] handler must validate the path param against this
// before it ever reaches getSubscription/updateSubscription/deleteSubscription
// (lib/subscriptions/queries.ts), the same way a request body is validated
// before reaching a query — otherwise a non-UUID id (a scanner probe, a
// stale/corrupted client link) crashes the route with an unhandled 500
// instead of a clean 400.
export const subscriptionIdSchema = z.string().uuid();
