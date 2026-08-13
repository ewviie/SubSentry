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
