import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailConnections, type EmailConnection } from "@/lib/db/schema";
import { encryptToken, decryptToken } from "@/lib/security/token-encryption";

export type EmailProvider = EmailConnection["provider"];

export interface CreateEmailConnectionInput {
  userId: string;
  provider: EmailProvider;
  emailAddress: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

// Upsert on (userId, provider) — a user reconnecting (e.g. after revoking
// access, or switching which Google account they authorize) replaces the
// prior connection rather than accumulating rows; only one Gmail
// connection is ever meaningful per user in this design (see schema.ts's
// comment on why this table doesn't support multiple, unlike
// bankConnections).
export async function createEmailConnection(input: CreateEmailConnectionInput): Promise<EmailConnection> {
  const [row] = await db
    .insert(emailConnections)
    .values({
      userId: input.userId,
      provider: input.provider,
      emailAddress: input.emailAddress,
      accessTokenEncrypted: encryptToken(input.accessToken),
      refreshTokenEncrypted: input.refreshToken ? encryptToken(input.refreshToken) : null,
      expiresAt: input.expiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: [emailConnections.userId, emailConnections.provider],
      set: {
        emailAddress: input.emailAddress,
        accessTokenEncrypted: encryptToken(input.accessToken),
        // A reconnect without a fresh refresh_token (Google only issues one
        // on the consent that originally granted it — see
        // gmail-client.ts's prompt=consent comment) must not overwrite a
        // still-good stored one with null.
        ...(input.refreshToken ? { refreshTokenEncrypted: encryptToken(input.refreshToken) } : {}),
        expiresAt: input.expiresAt ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function getEmailConnection(
  userId: string,
  provider: EmailProvider,
): Promise<EmailConnection | undefined> {
  const [row] = await db
    .select()
    .from(emailConnections)
    .where(and(eq(emailConnections.userId, userId), eq(emailConnections.provider, provider)))
    .limit(1);
  return row;
}

export async function deleteEmailConnection(userId: string, provider: EmailProvider): Promise<boolean> {
  const result = await db
    .delete(emailConnections)
    .where(and(eq(emailConnections.userId, userId), eq(emailConnections.provider, provider)))
    .returning({ id: emailConnections.id });
  return result.length > 0;
}

// Same optimistic-concurrency reasoning as
// bank-connections.ts's updateBankConnectionTokensIfUnchanged: two
// near-simultaneous syncs could both see the same connection as
// expiring-soon and both refresh: whichever write lands second must not
// stomp the winner's fresher tokens.
export async function updateEmailConnectionTokensIfUnchanged(
  id: string,
  previousAccessTokenEncrypted: string,
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null },
): Promise<boolean> {
  const result = await db
    .update(emailConnections)
    .set({
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined,
      expiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(eq(emailConnections.id, id), eq(emailConnections.accessTokenEncrypted, previousAccessTokenEncrypted)),
    )
    .returning({ id: emailConnections.id });
  return result.length > 0;
}

export async function markEmailConnectionSynced(id: string): Promise<void> {
  await db.update(emailConnections).set({ lastSyncedAt: new Date() }).where(eq(emailConnections.id, id));
}

export function decryptAccessToken(connection: EmailConnection): string {
  return decryptToken(connection.accessTokenEncrypted);
}

export function decryptRefreshToken(connection: EmailConnection): string | null {
  return connection.refreshTokenEncrypted ? decryptToken(connection.refreshTokenEncrypted) : null;
}
