import { quickAddSubscription, quickAddLineSchema } from "./parse-subscription";
import { checkQuickAddRateLimit } from "./rate-limit";
import { MAX_BULK_QUICK_ADD_LINES } from "@/lib/subscriptions/validation";
import type { SubscriptionInput } from "@/lib/subscriptions/validation";
import type { User } from "@/lib/db/schema";

// User Value Journey Audit, opportunity #1: the single biggest gap the
// audit found was that adding a real, multi-subscription portfolio meant
// N full round trips through the single quick-add bar (type -> wait ->
// review dialog -> confirm), one at a time, with no bank-export-free bulk
// path at all. This reuses quickAddSubscription (parse-subscription.ts)
// completely unmodified, called once per pasted line, rather than teaching
// the AI provider a new batch-shaped prompt — every line gets exactly the
// same re-validation against subscriptionInputSchema a single quick-add
// already gets, so nothing about per-line correctness changes, only how
// many lines one request can process.

export interface BulkQuickAddLineOk {
  ok: true;
  line: number;
  rawText: string;
  subscription: SubscriptionInput;
  confidence: "high" | "medium" | "low";
}

export interface BulkQuickAddLineError {
  ok: false;
  line: number;
  rawText: string;
  error: string;
  // True only for a line that was never even attempted because this
  // request's own AI-quota reservation pass (see reserveAndParse below)
  // had already run out before reaching it — distinct from a line that WAS
  // attempted and genuinely failed to parse (rateLimited stays undefined
  // there), so the UI can tell "try this again later" apart from "this
  // needs to be entered manually."
  rateLimited?: true;
}

export type BulkQuickAddLineResult = BulkQuickAddLineOk | BulkQuickAddLineError;

export interface BulkQuickAddResult {
  results: BulkQuickAddLineResult[];
  // How many non-blank lines beyond MAX_BULK_QUICK_ADD_LINES were dropped
  // before parsing ever started — never silently: the route/UI surfaces
  // this count rather than just returning fewer results than were pasted
  // with no explanation (same "never silently drop" posture review-table.tsx's
  // own MAX_IMPORT_ROWS handling already follows for CSV import).
  omittedLineCount: number;
}

// Pure and exported for direct unit testing (bulk-quick-add.test.ts) —
// blank lines carry no information and are dropped outright, not treated
// as "a line that failed to parse."
export function splitQuickAddLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// How many concurrent AI calls one bulk-parse request will have in flight
// at once. Bounded, not Promise.all-ing the whole (already-capped-at
// MAX_BULK_QUICK_ADD_LINES) batch at once — a real Anthropic call has its
// own latency and this is a synchronous, user-waiting request; capping
// concurrency keeps one large paste from opening up to
// MAX_BULK_QUICK_ADD_LINES simultaneous outbound calls, considerate of the
// upstream provider regardless of how generous this account's own quota is.
const PARSE_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// Reserves this user's daily AI-quota budget for a batch of lines in one
// sequential, synchronous-per-line pass BEFORE any actual (slow) parse call
// starts, then runs every reserved parse concurrently. Two things this
// buys over just calling checkQuickAddRateLimit inline inside the
// concurrent worker below: (1) deterministic "line N is the one that hit
// the cap" behavior — a caller reading the result array can trust that
// once a rateLimited:true result appears, every line after it in the
// original order was skipped for the exact same reason, not an artifact of
// which concurrent call happened to lose a race; (2) a line already known
// to be unreachable never pays for a wasted outbound AI call.
async function reserveAndParse(
  userId: string,
  plan: User["plan"],
  lines: string[],
): Promise<BulkQuickAddLineResult[]> {
  const reserved: { index: number; line: string }[] = [];
  const results: BulkQuickAddLineResult[] = new Array(lines.length);

  for (const [index, rawText] of lines.entries()) {
    const lineCheck = quickAddLineSchema.safeParse(rawText);
    if (!lineCheck.success) {
      // Never spends an AI call or a quota slot on a line this app already
      // knows it can't accept — same bound (3-280 chars) a single quick-add
      // line gets, so a garbage or empty-after-trim line is rejected the
      // same honest way here as it would be typed directly into the bar.
      results[index] = { ok: false, line: index + 1, rawText, error: lineCheck.error.issues[0]?.message ?? "Couldn't read that line." };
      continue;
    }

    const rateLimit = await checkQuickAddRateLimit(userId, plan);
    if (!rateLimit.allowed) {
      results[index] = {
        ok: false,
        line: index + 1,
        rawText,
        error: "Today's AI parsing limit was reached partway through this list.",
        rateLimited: true,
      };
      continue;
    }

    reserved.push({ index, line: lineCheck.data });
  }

  await mapWithConcurrency(reserved, PARSE_CONCURRENCY, async ({ index, line }) => {
    const parsed = await quickAddSubscription(line);
    results[index] = parsed.ok
      ? { ok: true, line: index + 1, rawText: line, subscription: parsed.subscription, confidence: parsed.confidence }
      : { ok: false, line: index + 1, rawText: line, error: parsed.error };
  });

  return results;
}

// The one entry point the bulk-parse route calls. Splits, caps at
// MAX_BULK_QUICK_ADD_LINES (never silently — omittedLineCount reports
// exactly how many non-blank lines beyond the cap were never even
// attempted), then reserves quota and parses.
export async function runBulkQuickAdd(userId: string, plan: User["plan"], text: string): Promise<BulkQuickAddResult> {
  const allLines = splitQuickAddLines(text);
  const lines = allLines.slice(0, MAX_BULK_QUICK_ADD_LINES);
  const omittedLineCount = allLines.length - lines.length;

  const results = await reserveAndParse(userId, plan, lines);
  return { results, omittedLineCount };
}
