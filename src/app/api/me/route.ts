import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  updateUserName,
  setRenewalRemindersEnabled,
  setPriceAlertEmailsEnabled,
  setWeeklyDigestEnabled,
  setRenewalReminderLeadDays,
} from "@/lib/auth/queries";
import { RENEWAL_REMINDER_LEAD_DAYS_OPTIONS } from "@/lib/subscriptions/filters";
import { checkProfileUpdateRateLimit } from "@/lib/auth/rate-limit";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/lib/http/request-size";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  const { id, email, name, plan, renewalRemindersEnabled, priceAlertEmailsEnabled, weeklyDigestEnabled, renewalReminderLeadDays } =
    session.user;
  return NextResponse.json({
    user: { id, email, name, plan, renewalRemindersEnabled, priceAlertEmailsEnabled, weeklyDigestEnabled, renewalReminderLeadDays },
  });
}

// Every field optional, but at least one required (the .refine below) —
// this one route backs every independent Settings notification control
// (name, and now five preference toggles/selects) that each send only the
// field they're changing; a bare `{}` body isn't a meaningful update to
// reject with the same "invalid_request" as truly malformed input, rather
// than silently a no-op 200.
const updateMeSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    renewalRemindersEnabled: z.boolean().optional(),
    priceAlertEmailsEnabled: z.boolean().optional(),
    weeklyDigestEnabled: z.boolean().optional(),
    renewalReminderLeadDays: z.number().refine((v) => (RENEWAL_REMINDER_LEAD_DAYS_OPTIONS as readonly number[]).includes(v), {
      message: "Not a valid reminder window.",
    }).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.renewalRemindersEnabled !== undefined ||
      data.priceAlertEmailsEnabled !== undefined ||
      data.weeklyDigestEnabled !== undefined ||
      data.renewalReminderLeadDays !== undefined,
    { message: "No fields to update." },
  );

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
  if (parsed.data.priceAlertEmailsEnabled !== undefined) {
    await setPriceAlertEmailsEnabled(session.user.id, parsed.data.priceAlertEmailsEnabled);
  }
  if (parsed.data.weeklyDigestEnabled !== undefined) {
    await setWeeklyDigestEnabled(session.user.id, parsed.data.weeklyDigestEnabled);
  }
  if (parsed.data.renewalReminderLeadDays !== undefined) {
    await setRenewalReminderLeadDays(session.user.id, parsed.data.renewalReminderLeadDays);
  }
  return NextResponse.json({ ok: true });
}
