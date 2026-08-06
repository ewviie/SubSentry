import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listImports } from "@/lib/imports/queries";
import { summarizeImports } from "@/lib/imports/history";
import { checkImportHistoryRateLimit } from "@/lib/imports/rate-limit";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkImportHistoryRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests. Try again in a bit." },
      { status: 429 },
    );
  }

  const records = await listImports(session.user.id);
  return NextResponse.json({ imports: summarizeImports(records) });
}
