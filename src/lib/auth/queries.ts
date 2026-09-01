import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function updateUserName(userId: string, name: string): Promise<void> {
  await db
    .update(users)
    .set({ name: name || null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// Shared by the Settings toggle (api/me PATCH, session-authenticated) and
// the one-click unsubscribe link renewal reminder emails carry
// (api/renewal-reminders/unsubscribe, HMAC-token-authenticated instead of a
// session — see renewal-reminders.ts's verifyUnsubscribeToken) — both are
// just "set this boolean", so both go through the same write rather than
// each running its own update() call.
export async function setRenewalRemindersEnabled(userId: string, enabled: boolean): Promise<void> {
  await db
    .update(users)
    .set({ renewalRemindersEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setPriceAlertEmailsEnabled(userId: string, enabled: boolean): Promise<void> {
  await db
    .update(users)
    .set({ priceAlertEmailsEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function setWeeklyDigestEnabled(userId: string, enabled: boolean): Promise<void> {
  await db
    .update(users)
    .set({ weeklyDigestEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// Validated against the same (1, 3, 7, 14, 30) set the DB check constraint
// enforces (schema.ts) before this is ever called — see api/me/route.ts's
// updateMeSchema — so this is defense-in-depth, not the first line of
// validation.
export async function setRenewalReminderLeadDays(userId: string, days: number): Promise<void> {
  await db
    .update(users)
    .set({ renewalReminderLeadDays: days, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
