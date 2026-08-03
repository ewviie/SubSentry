import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function updateUserName(userId: string, name: string): Promise<void> {
  await db
    .update(users)
    .set({ name: name || null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
