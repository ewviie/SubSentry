import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { runBulkQuickAdd } from "@/lib/ai/bulk-quick-add";
import { checkBulkQuickAddParseRateLimit } from "@/lib/subscriptions/rate-limit";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

// Well above MAX_BULK_QUICK_ADD_LINES * (a realistic line length) so a
// legitimate paste is never truncated by this bound before line-splitting
// ever runs — it exists only to reject an unreasonably large payload before
// it's even parsed into lines, the same defensive-body-size posture every
// other POST route in this app already applies via readJsonBody.
const bulkQuickAddParseSchema = z.object({
  text: z.string().trim().min(1, "Paste at least one line, e.g. \"Netflix $15.99/mo\"").max(6000, "That's a lot of text at once — try a shorter list"),
});

// Step 1 of bulk quick-add (User Value Journey Audit, opportunity #1):
// parses a pasted multi-line list into a reviewable draft per line. Nothing
// is persisted here — same "nothing is saved until you confirm" contract
// the single quick-add dialog and the Import Center's review step already
// establish. Free and Pro both reach this route identically; the only
// gating that exists is the same per-line AI-quota check a single quick-add
// already applies (see bulk-quick-add.ts's reserveAndParse), never an
// activation-blocking paywall.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkBulkQuickAddParseRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many bulk-add attempts recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = bulkQuickAddParseSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { results, omittedLineCount } = await runBulkQuickAdd(session.user.id, session.user.plan, parsed.data.text);
  if (results.length === 0) {
    return NextResponse.json(
      { error: "invalid_request", message: "Paste at least one line, e.g. \"Netflix $15.99/mo\"." },
      { status: 400 },
    );
  }

  return NextResponse.json({ results, omittedLineCount });
}
