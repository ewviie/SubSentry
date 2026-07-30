import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { checkSignupRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const rateLimit = checkSignupRateLimit(getClientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many signups from this network. Try again later." },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "email_taken", message: "An account with that email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    // The check above is a fast, friendly-error common case — it doesn't
    // close the race where two signups for the same email land between
    // the check and this insert. users.email has a DB-level unique
    // constraint (schema.ts), so that race surfaces here as a Postgres
    // unique-violation (23505) instead of a duplicate row, and gets mapped
    // to the same 409 rather than bubbling up as an unhandled 500.
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: name || null })
      .returning({ id: users.id });
    userId = user.id;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return NextResponse.json(
        { error: "email_taken", message: "An account with that email already exists." },
        { status: 409 },
      );
    }
    throw error;
  }

  await createSession(userId);

  return NextResponse.json({ ok: true });
}
