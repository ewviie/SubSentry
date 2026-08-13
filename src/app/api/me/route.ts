import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { updateUserName, setRenewalRemindersEnabled } from "@/lib/auth/queries";
import { checkProfileUpdateRateLimit } from "@/lib/auth/rate-limit";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  const { id, email, name, plan, renewalRemindersEnabled } = session.user;
  return NextResponse.json({ user: { id, email, name, plan, renewalRemindersEnabled } });
}

// Both fields optional, but at least one required (the .refine below) —
// this one route now backs two independent Settings controls (name,
// renewal-reminder toggle) that each send only the field they're changing;
// a bare `{}` body isn't a meaningful update to reject with the same
// "invalid_request" as truly malformed input, rather than silently a no-op
// 200.
const updateMeSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    renewalRemindersEnabled: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.renewalRemindersEnabled !== undefined, {
    message: "No fields to update.",
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

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (body.tooLarge) {
    return NextResponse.json({ error: "payload_too_large", message: "Request body is too large." }, { status: 413 });
  }

  const parsed = updateMeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  if (parsed.data.name !== undefined) {
    await updateUserName(session.user.id, parsed.data.name);
  }
  if (parsed.data.renewalRemindersEnabled !== undefined) {
    await setRenewalRemindersEnabled(session.user.id, parsed.data.renewalRemindersEnabled);
  }
  return NextResponse.json({ ok: true });
}
