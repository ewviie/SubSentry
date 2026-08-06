import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteEmailConnection } from "@/lib/imports/email-connections";

// Deletes the stored connection row outright (not a soft "disabled" flag) —
// the whole point of a disconnect action is that the encrypted token stops
// existing in this app's database at all, not just stops being used.
// Doesn't call Google's own token-revocation endpoint: that's a real gap
// (the token stays technically valid at Google's end until it expires or
// the user separately revokes it from myaccount.google.com/permissions),
// noted rather than silently assumed away — revoking server-side too is a
// reasonable follow-up, not done here to keep this route's one job (stop
// this app from being able to use the token) unambiguous.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await deleteEmailConnection(session.user.id, "gmail");
  return NextResponse.json({ ok: true });
}
