import { CATEGORY_LABELS, BILLING_CYCLE_LABELS, STATUS_LABELS } from "./labels";
import { centsToAmountString } from "./money";
import type { Subscription } from "@/lib/db/schema";

const EXPORT_COLUMNS = ["Name", "Amount", "Currency", "Billing cycle", "Category", "Next renewal", "Status", "Notes"] as const;

// RFC 4180 minimal escaping: a field only needs quoting if it contains the
// delimiter, a quote, or a line break — anything else is written bare, so
// a plain "Netflix" doesn't turn into `"Netflix"` for no reason. An
// embedded quote is doubled, the standard CSV-escape convention every
// spreadsheet app already expects.
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}

// A plain data export, not a re-importable format for this app's own CSV
// import (that's for bank statements — see providers/csv-bank-provider.ts
// — an entirely different shape). This is a user's own tracked
// subscriptions, in the same units they see in the UI (a currency's major
// unit via centsToAmountString, not raw cents; display labels, not raw
// enum values), so it opens as something a person can actually read in a
// spreadsheet.
export function subscriptionsToCsv(subscriptions: Subscription[]): string {
  const rows = [csvRow([...EXPORT_COLUMNS])];
  for (const s of subscriptions) {
    rows.push(
      csvRow([
        s.name,
        centsToAmountString(s.amountCents),
        s.currency.toUpperCase(),
        BILLING_CYCLE_LABELS[s.billingCycle],
        CATEGORY_LABELS[s.category],
        s.nextRenewalDate,
        STATUS_LABELS[s.status],
        s.notes ?? "",
      ]),
    );
  }
  // \r\n line endings: the CSV convention every spreadsheet app expects,
  // not just the Unix default a plain \n join would produce.
  return rows.join("\r\n") + "\r\n";
}
