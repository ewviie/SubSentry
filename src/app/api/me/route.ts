import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { updateUserName } from "@/lib/auth/queries";
import { checkProfileUpdateRateLimit } from "@/lib/auth/rate-limit";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  const { id, email, name, plan } = session.user;
  return NextResponse.json({ user: { id, email, name, plan } });
}

const updateMeSchema = z.object({
  name: z.string().trim().max(120),
});

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rateLimit = checkProfileUpdateRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many changes recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const parsed = updateMeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  await updateUserName(session.user.id, parsed.data.name);
  return NextResponse.json({ ok: true });
}
