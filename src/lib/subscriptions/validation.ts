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

// Exported for merchant-normalizer.ts's fallback display-name path, which
// needs to truncate to this exact bound rather than duplicate the literal —
// see its own comment on why.
export const MAX_SUBSCRIPTION_NAME_LENGTH = 120;

// The regex only checks YYYY-MM-DD shape — 2026-02-31 would pass it and then
// get rejected by Postgres's `date` column at insert/update time. Round-trip
// through Date.UTC to catch calendar-invalid dates before they reach the DB.
// Exported for csv-parser.ts's parseDateToISO, which needs the exact same
// check (see its own comment) — not re-derived a second time.
export function isValidCalendarDate(value: string): boolean {
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
  name: z.string().trim().min(1, "Name is required").max(MAX_SUBSCRIPTION_NAME_LENGTH),
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
// priceHistorySource is additive to .partial()'d baseFields, not merged into
// them — same "no .default() on a field a real partial update can omit"
// reasoning as baseFields' own comment, and it's provenance metadata only
// (same "client's hint, no effect on validation/authorization" precedent
// POST /api/subscriptions' own `source` field already sets), never trusted
// for anything but labeling which subscriptionPriceHistory row this write
// produces. Omitted entirely by every existing caller (the manual edit
// form, bulk status/PATCH calls) — updateSubscription defaults it to
// "user_edit" — so this is purely additive, not a behavior change for any
// existing write path.
export const subscriptionUpdateSchema = z.object(baseFields).partial().extend({
  priceHistorySource: z.enum(["user_edit", "import_update"]).optional(),
});
export type SubscriptionUpdate = z.infer<typeof subscriptionUpdateSchema>;

// Bulk quick-add (User Value Journey Audit, opportunity #1): the same
// per-line cap a single quick-add line gets — see lib/ai/parse-subscription.ts's
// own quickAddLineSchema, which this bound is shared with — times a real,
// bounded batch size. 20 is generous for a real household's subscription
// list (the audit's own worked example was "8-15 subscriptions") while
// staying small enough that one request can't queue an unbounded number of
// AI parse calls (see lib/ai/bulk-quick-add.ts's own concurrency-bounded
// orchestration) or, at confirm time, an unbounded insert batch. Distinct
// from MAX_IMPORT_ROWS (200, lib/imports/validation.ts) — that bound exists
// for a bank-CSV/transaction-clustering batch, a genuinely different scale
// and cost shape (no AI call per row) than a hand-pasted list of lines a
// human is expected to have actually typed or copied themselves.
export const MAX_BULK_QUICK_ADD_LINES = 20;

// The confirm endpoint's request body (api/subscriptions/quick-add/bulk/confirm)
// — every row re-validated through the exact same subscriptionInputSchema
// the manual form, single quick-add, and CSV import confirm all use.
// Nothing from the bulk-parse response is trusted here: the client's review
// step may have edited any field before this ever posts. No `source`
// field, unlike importConfirmSchema's own — this endpoint always tags rows
// "ai_parsed" itself (see the route), never client-supplied, so there's no
// enum to restrict against smuggling.
export const bulkQuickAddConfirmSchema = z.object({
  rows: z.array(subscriptionInputSchema).min(1, "Nothing to add").max(MAX_BULK_QUICK_ADD_LINES),
});
export type BulkQuickAddConfirmInput = z.infer<typeof bulkQuickAddConfirmSchema>;

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
