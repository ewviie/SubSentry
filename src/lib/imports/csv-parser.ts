import { amountStringToCents } from "@/lib/subscriptions/money";
import { isValidCalendarDate } from "@/lib/subscriptions/validation";
import { neutralizeFormulaInjection } from "./sanitize";
import type { ImportParseResult, RawTransaction } from "./types";

// RFC4180-ish tokenizer: quote-aware (embedded commas/newlines inside a
// quoted field, "" as an escaped quote), BOM-stripping. Hand-rolled rather
// than a dependency — this codebase already hand-rolls everything that
// reasonably can be (rate limiting, auth/session, CSP), and real-world bank
// exports don't need more than this; if that assumption turns out wrong for
// a real file, this is the one function to swap.
export function parseCsvRows(fileText: string): string[][] {
  const text = fileText.charCodeAt(0) === 0xfeff ? fileText.slice(1) : fileText;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    // Skip fully-blank trailing rows (common at the end of exported files)
    // rather than surfacing them as malformed data downstream.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  // Final field/row if the file doesn't end with a trailing newline.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

export interface HeaderAliases {
  date: string[];
  description: string[];
  merchant: string[];
  amount: string[];
  debit: string[];
  credit: string[];
  direction: string[];
  reference: string[];
  currency: string[];
}

export interface NormalizedHeaderMap {
  date: number | null;
  description: number | null;
  merchant: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  direction: number | null;
  reference: number | null;
  currency: number | null;
}

function normalizeHeaderText(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Column-order independence: match each canonical field against a list of
// known aliases rather than assuming a fixed position, so "Date, Merchant,
// Amount" and "Amount, Description, Date" both work identically.
export function normalizeHeaders(headerRow: string[], aliases: HeaderAliases): NormalizedHeaderMap {
  const normalized = headerRow.map(normalizeHeaderText);

  function findColumn(fieldAliases: string[]): number | null {
    for (const alias of fieldAliases) {
      const target = normalizeHeaderText(alias);
      const index = normalized.indexOf(target);
      if (index !== -1) return index;
    }
    return null;
  }

  return {
    date: findColumn(aliases.date),
    description: findColumn(aliases.description),
    merchant: findColumn(aliases.merchant),
    amount: findColumn(aliases.amount),
    debit: findColumn(aliases.debit),
    credit: findColumn(aliases.credit),
    direction: findColumn(aliases.direction),
    reference: findColumn(aliases.reference),
    currency: findColumn(aliases.currency),
  };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "usd",
  "£": "gbp",
  "€": "eur",
  "¥": "jpy",
};

function detectCurrencyFromAmountString(raw: string): string | null {
  const trimmed = raw.trim();
  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];
  return CURRENCY_SYMBOLS[firstChar] ?? CURRENCY_SYMBOLS[lastChar] ?? null;
}

// Exported: gmail-extract.ts reuses this for the same reason a CSV cell
// needs it — a regex-matched amount out of raw email text ("$9.99",
// "USD 9.99") still has a currency symbol/thousands separator to strip
// before amountStringToCents (money.ts) can parse it.
export function cleanAmountString(raw: string): string {
  // Strip currency symbols, thousands separators, and surrounding
  // whitespace, but keep a leading "-" (sign) and the decimal point.
  return raw.trim().replace(/[^\d.,-]/g, "").replace(/,/g, "");
}

function parseDateToISO(raw: string): string | null {
  const trimmed = raw.trim();
  // Accept YYYY-MM-DD directly — but only once isValidCalendarDate confirms
  // it's a real date. The regex alone only checks shape: "2026-02-31" used
  // to pass straight through unchanged (a calendar-invalid date, same class
  // of bug validation.ts's own isValidCalendarDate exists to catch for the
  // manual-add/quick-add path). That let one bad row in an otherwise-valid
  // CSV reach the review UI showing a bogus date, then fail confirm's
  // subscriptionInputSchema check well after upload — and since
  // /api/imports/confirm validates the whole batch as one Zod array, a
  // single malformed date failed the *entire* import, not just that row,
  // with no indication of which of possibly dozens of rows was the problem.
  // Catching it here instead means it's skipped at parse time with the
  // same "unparseable or missing date" warning every other bad date already
  // gets, consistent with how this function treats every other malformed
  // row.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isValidCalendarDate(trimmed) ? trimmed : null;
  // Accept common bank-export formats: MM/DD/YYYY, DD/MM/YYYY is ambiguous
  // without locale info, so this deliberately only handles the
  // unambiguous ISO and slash-separated-with-4-digit-year cases; anything
  // else is treated as unparseable and the row is skipped rather than
  // guessed at.
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    const month = Number(a) > 12 ? Number(b) : Number(a);
    const day = Number(a) > 12 ? Number(a) : Number(b);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // Same calendar-validity gap as the ISO branch above — day <= 31 alone
    // still accepts e.g. "4/31/2026" (April has 30 days).
    return isValidCalendarDate(iso) ? iso : null;
  }
  return null;
}

export interface ParseCsvOptions {
  aliases: HeaderAliases;
  defaultCurrency?: string;
  // Used only for the single-signed-amount-column case, when there's no
  // debit/credit column pair and no direction-label column to read from,
  // AND the amount has no leading "-" to infer a debit from. Bank exports
  // are genuinely ambiguous here, so the historical default is "credit"
  // (preserved when this option is omitted). App-store-style exports (Apple,
  // Google Play) have no such ambiguity — every row is a purchase charge —
  // so those providers pass "debit" explicitly rather than relying on a sign
  // that will never be present in their export format.
  defaultDirection?: "debit" | "credit";
}

export function parseCsvTransactions(fileText: string, options: ParseCsvOptions): ImportParseResult {
  const warnings: string[] = [];
  let skippedRowCount = 0;
  const transactions: RawTransaction[] = [];

  const rows = parseCsvRows(fileText);
  if (rows.length === 0) {
    return { transactions: [], warnings: ["File is empty."], skippedRowCount: 0 };
  }

  const headerMap = normalizeHeaders(rows[0], options.aliases);
  if (headerMap.date === null) {
    return { transactions: [], warnings: ["No recognizable date column found."], skippedRowCount: 0 };
  }
  if (headerMap.amount === null && headerMap.debit === null && headerMap.credit === null) {
    return { transactions: [], warnings: ["No recognizable amount column found."], skippedRowCount: 0 };
  }
  if (headerMap.description === null && headerMap.merchant === null) {
    return { transactions: [], warnings: ["No recognizable merchant/description column found."], skippedRowCount: 0 };
  }

  let currencyWarningShown = false;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row.every((cell) => cell.trim() === "")) continue; // blank row, not malformed

    const dateRaw = headerMap.date !== null ? row[headerMap.date] : undefined;
    const iso = dateRaw ? parseDateToISO(dateRaw) : null;
    if (!iso) {
      warnings.push(`Row ${rowIndex + 1}: unparseable or missing date, skipped.`);
      skippedRowCount++;
      continue;
    }

    const descriptionRaw =
      (headerMap.merchant !== null ? row[headerMap.merchant] : undefined) ??
      (headerMap.description !== null ? row[headerMap.description] : undefined) ??
      "";
    if (descriptionRaw.trim() === "") {
      warnings.push(`Row ${rowIndex + 1}: missing merchant/description, skipped.`);
      skippedRowCount++;
      continue;
    }

    let amountCents: number;
    let direction: "debit" | "credit";

    if (headerMap.debit !== null || headerMap.credit !== null) {
      const debitRaw = headerMap.debit !== null ? row[headerMap.debit]?.trim() : "";
      const creditRaw = headerMap.credit !== null ? row[headerMap.credit]?.trim() : "";
      if (debitRaw) {
        const cleaned = cleanAmountString(debitRaw).replace(/^-/, "");
        // Same guard as the single-amount-column branch below — most
        // non-numeric garbage in this column (e.g. "N/A") strips down to an
        // empty string, which amountStringToCents already turns into a
        // harmless 0 (caught by the zero-amount check further down), but a
        // value like "--" strips to a bare "-", which Number("-") is NaN,
        // not 0. Without this check that NaN silently became this row's
        // amountCents (NaN !== 0, so the zero-amount check doesn't catch
        // it), reaching the review UI and — since /api/imports/confirm
        // validates its whole rows array as one Zod parse — failing the
        // user's *entire* batch on confirm if left unedited, not just this
        // one row.
        if (cleaned === "" || Number.isNaN(Number(cleaned))) {
          warnings.push(`Row ${rowIndex + 1}: unparseable debit amount, skipped.`);
          skippedRowCount++;
          continue;
        }
        amountCents = amountStringToCents(cleaned);
        direction = "debit";
      } else if (creditRaw) {
        const cleaned = cleanAmountString(creditRaw).replace(/^-/, "");
        if (cleaned === "" || Number.isNaN(Number(cleaned))) {
          warnings.push(`Row ${rowIndex + 1}: unparseable credit amount, skipped.`);
          skippedRowCount++;
          continue;
        }
        amountCents = amountStringToCents(cleaned);
        direction = "credit";
      } else {
        warnings.push(`Row ${rowIndex + 1}: no debit or credit amount, skipped.`);
        skippedRowCount++;
        continue;
      }
    } else {
      const amountRaw = row[headerMap.amount!]?.trim() ?? "";
      const cleaned = cleanAmountString(amountRaw);
      if (cleaned === "" || cleaned === "-" || Number.isNaN(Number(cleaned))) {
        warnings.push(`Row ${rowIndex + 1}: unparseable amount, skipped.`);
        skippedRowCount++;
        continue;
      }
      // amountStringToCents assumes a non-negative string (it's normally
      // only ever fed the manual-form's amount field, which the zod schema
      // never allows a leading "-" on) — strip the sign first and track
      // direction separately, rather than passing a signed string through
      // it, which would silently corrupt the cents math (e.g. "-15.99"
      // would compute as -1500 + 99 = -1401 instead of -1599).
      const isNegative = cleaned.startsWith("-");
      const unsigned = isNegative ? cleaned.slice(1) : cleaned;
      // A direction-label column, if present, is authoritative; otherwise a
      // negative amount means money leaving the account (debit).
      const directionLabel =
        headerMap.direction !== null ? row[headerMap.direction]?.trim().toLowerCase() : undefined;
      if (directionLabel) {
        direction = directionLabel.startsWith("cr") ? "credit" : "debit";
      } else if (isNegative) {
        direction = "debit";
      } else {
        direction = options.defaultDirection ?? "credit";
      }
      amountCents = amountStringToCents(unsigned);
    }

    if (amountCents === 0) {
      warnings.push(`Row ${rowIndex + 1}: zero amount, skipped.`);
      skippedRowCount++;
      continue;
    }

    let currency =
      headerMap.currency !== null
        ? row[headerMap.currency]?.trim().toLowerCase()
        : undefined;
    if (!currency) {
      const amountCell =
        headerMap.amount !== null
          ? row[headerMap.amount]
          : (headerMap.debit !== null ? row[headerMap.debit] : row[headerMap.credit!]);
      currency = amountCell ? (detectCurrencyFromAmountString(amountCell) ?? undefined) : undefined;
    }
    if (!currency) {
      currency = options.defaultCurrency ?? "usd";
      if (!currencyWarningShown) {
        warnings.push("No currency column or symbol found; assumed USD for all rows.");
        currencyWarningShown = true;
      }
    }

    const reference = headerMap.reference !== null ? row[headerMap.reference]?.trim() : undefined;

    transactions.push({
      date: iso,
      description: neutralizeFormulaInjection(descriptionRaw.trim()),
      amountCents,
      direction,
      currency,
      reference: reference ? neutralizeFormulaInjection(reference) : undefined,
    });
  }

  return { transactions, warnings, skippedRowCount };
}
