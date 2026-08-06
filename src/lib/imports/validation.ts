import { z } from "zod";
import { subscriptionInputSchema } from "@/lib/subscriptions/validation";

export const IMPORT_SOURCES = [
  "csv_import",
  "apple_import",
  "google_play_import",
  "plaid_import",
  "truelayer_import",
  "gmail_import",
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

// A second, independent validation gate on every parsed row, applied right
// after the CSV parser produces RawTransaction objects and before they ever
// reach the detection engine — the parser's own inline checks (see
// csv-parser.ts) already filter out most malformed rows, but this catches
// anything that slipped through with a strict, explicit schema, matching
// the defensive-parsing posture already established for untrusted external
// input elsewhere in the app (see api/stripe/webhook/route.ts).
export const rawTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int().positive().max(2_147_483_647),
  direction: z.enum(["debit", "credit"]),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Invalid currency code"),
  reference: z.string().trim().max(500).optional(),
});

// The confirm endpoint's request body. Each row is re-validated through the
// exact same subscriptionInputSchema the manual form and quick-add both
// use — nothing from the analyze response is trusted at confirm time, since
// the client-side Edit step may have mutated any field. `source` is
// restricted to the three import values here (not the full
// SUBSCRIPTION_SOURCES set) so a client can't smuggle "manual" or
// "ai_parsed" through this endpoint.
export const importConfirmSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  rows: z.array(subscriptionInputSchema).min(1, "Select at least one subscription to import").max(200),
  // How many detected rows the user chose not to import — carried along
  // purely for the import-history record's context, has no effect on what
  // gets created.
  ignoredCount: z.number().int().min(0).max(1000).default(0),
});

export type ImportConfirmInput = z.infer<typeof importConfirmSchema>;
