import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listImports } from "@/lib/imports/queries";
import { summarizeImports } from "@/lib/imports/history";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const records = await listImports(session.user.id);
  return NextResponse.json({ imports: summarizeImports(records) });
}
