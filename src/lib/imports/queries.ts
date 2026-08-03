import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { imports, subscriptions, type Import } from "@/lib/db/schema";
import { amountStringToCents } from "@/lib/subscriptions/money";
import type { SubscriptionInput } from "@/lib/subscriptions/validation";
import type { ImportSource } from "./validation";

// Bounds how large the persisted error summary can get on a maximally
// malformed file — a structured audit trail, not a dump of every parser
// warning verbatim.
const MAX_STORED_ERRORS = 20;

export interface CreateImportRecordInput {
  userId: string;
  source: ImportSource;
  status: "reviewed" | "completed" | "failed";
  detectedCount: number;
  importedCount: number;
  ignoredCount: number;
  errors: { row?: number; message: string }[];
}

export async function createImportRecord(input: CreateImportRecordInput): Promise<Import> {
  const [row] = await db
    .insert(imports)
    .values({
      userId: input.userId,
      source: input.source,
      status: input.status,
      detectedCount: input.detectedCount,
      importedCount: input.importedCount,
      ignoredCount: input.ignoredCount,
      errors: input.errors.slice(0, MAX_STORED_ERRORS),
    })
    .returning();
  return row;
}

export async function listImports(userId: string): Promise<Import[]> {
  return db.select().from(imports).where(eq(imports.userId, userId)).orderBy(desc(imports.createdAt));
}

export async function getImport(userId: string, id: string): Promise<Import | undefined> {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.userId, userId), eq(imports.id, id)))
    .limit(1);
  return row;
}

// Bulk-creates every confirmed row as ONE multi-row insert — deliberately
// not a loop of N independent createSubscription() calls. Postgres makes a
// single multi-row INSERT atomic on its own, and against the local PGlite
// dev server, N parallel un-transactioned queries would risk reproducing
// the unnamed-prepared-statement corruption bug already fixed in
// src/lib/db/index.ts (see that file's comment on the PGlite concurrency
// special-case) — a single round trip sidesteps that class of bug entirely
// rather than needing an explicit db.transaction() wrapper.
export async function bulkCreateSubscriptionsFromImport(
  userId: string,
  rows: SubscriptionInput[],
  source: ImportSource,
) {
  if (rows.length === 0) return [];
  return db
    .insert(subscriptions)
    .values(
      rows.map((input) => ({
        userId,
        name: input.name,
        amountCents: amountStringToCents(input.amount),
        currency: input.currency,
        billingCycle: input.billingCycle,
        category: input.category,
        nextRenewalDate: input.nextRenewalDate,
        status: input.status,
        notes: input.notes || null,
        source,
      })),
    )
    .returning();
}
