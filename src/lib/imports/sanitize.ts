// OWASP-recommended mitigation for CSV/formula injection: if a cell value
// starts with a character a spreadsheet application (Excel, Sheets) would
// interpret as the start of a formula, prefix it with a leading apostrophe
// so it's forced to render as literal text instead. Applied at the earliest
// point free text is produced — inside the parser itself, immediately after
// a row is read — so it's baked into every RawTransaction.description before
// that string ever reaches detection output, an API response, the review
// UI, or the database. This covers the concern by construction rather than
// needing re-application at every place the string is later displayed,
// stored, or re-exported.
const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@"];

export function neutralizeFormulaInjection(value: string): string {
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  if (!FORMULA_INJECTION_PREFIXES.includes(trimmed[0])) return value;
  return `'${value}`;
}
