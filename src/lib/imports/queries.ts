import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { imports, type Import } from "@/lib/db/schema";
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
