import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  const { id, email, name, plan } = session.user;
  return NextResponse.json({ user: { id, email, name, plan } });
}
