import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankConnections, type BankConnection } from "@/lib/db/schema";
import { encryptToken, decryptToken } from "@/lib/security/token-encryption";

export type BankProvider = BankConnection["provider"];

export interface CreateBankConnectionInput {
  userId: string;
  provider: BankProvider;
  providerItemId: string;
  institutionName: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export async function createBankConnection(input: CreateBankConnectionInput): Promise<BankConnection> {
  const [row] = await db
    .insert(bankConnections)
    .values({
      userId: input.userId,
      provider: input.provider,
      providerItemId: input.providerItemId,
      institutionName: input.institutionName,
      accessTokenEncrypted: encryptToken(input.accessToken),
      refreshTokenEncrypted: input.refreshToken ? encryptToken(input.refreshToken) : null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  return row;
}

// Multi-institution management (linking more than one account per provider,
// letting a user pick which to sync) is out of scope for this milestone —
// every sync path just reads the most recently linked connection for that
// provider, the same "one connection drives the feature" simplification
// src/lib/billing/plan.ts makes for a single Stripe customer per user.
export async function getLatestBankConnection(
  userId: string,
  provider: BankProvider,
): Promise<BankConnection | undefined> {
  const [row] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.userId, userId), eq(bankConnections.provider, provider)))
    .orderBy(desc(bankConnections.createdAt))
    .limit(1);
  return row;
}

export async function listBankConnections(userId: string): Promise<BankConnection[]> {
  return db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.userId, userId))
    .orderBy(desc(bankConnections.createdAt));
}

// Deletes every connection this user has for the given provider outright —
// same "the token stops existing in this app's database at all, not just
// stops being used" reasoning as deleteEmailConnection (email-connections.ts).
// Plural delete, not a single-row one keyed by id: a user can have more than
// one bank_connections row per provider (multi-institution linking, unlike
// email_connections' one-per-provider design — see schema.ts), and
// "disconnect Plaid" means all of them, not whichever happens to be latest.
export async function deleteBankConnection(userId: string, provider: BankProvider): Promise<BankConnection[]> {
  return db
    .delete(bankConnections)
    .where(and(eq(bankConnections.userId, userId), eq(bankConnections.provider, provider)))
    .returning();
}

// Optimistic-concurrency variant for TrueLayer's refresh path: two
// near-simultaneous syncs can both see the same connection as "expiring
// soon" and both call refreshAccessToken with the same refresh token.
// TrueLayer rotates refresh tokens on use, so whichever request's write
// lands second would otherwise silently overwrite the winner's fresher
// tokens with its own — potentially persisting a refresh token TrueLayer
// already invalidated. Conditioning the WHERE clause on the row still
// holding the ciphertext this request originally read makes the losing
// request's write a no-op instead of a stomp.
export async function updateBankConnectionTokensIfUnchanged(
  id: string,
  previousAccessTokenEncrypted: string,
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null },
): Promise<boolean> {
  const result = await db
    .update(bankConnections)
    .set({
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined,
      expiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(and(eq(bankConnections.id, id), eq(bankConnections.accessTokenEncrypted, previousAccessTokenEncrypted)))
    .returning({ id: bankConnections.id });
  return result.length > 0;
}

// Watchdog phase: the cross-user candidate query for the automatic sync
// cron — same "bounded per-run scan, fair rotation via nulls-first oldest-
// synced ordering" shape weekly-digest-job.ts's own findDigestCandidates
// already established for the digest cron. Every other query in this file
// is scoped to one caller's own userId (session-authenticated interactive
// routes); this is the one legitimate cross-user read, and it belongs here
// (not duplicated in the sync job) since it's this table's own query.
const SYNC_CANDIDATES_PER_RUN = 200;

export async function listBankConnectionsForSync(limit = SYNC_CANDIDATES_PER_RUN): Promise<BankConnection[]> {
  return db
    .select()
    .from(bankConnections)
    .orderBy(sql`${bankConnections.lastSyncedAt} asc nulls first`, asc(bankConnections.id))
    .limit(limit);
}

export async function markBankConnectionSynced(id: string, syncedAt: Date = new Date()): Promise<void> {
  await db.update(bankConnections).set({ lastSyncedAt: syncedAt }).where(eq(bankConnections.id, id));
}

export function decryptAccessToken(connection: BankConnection): string {
  return decryptToken(connection.accessTokenEncrypted);
}

export function decryptRefreshToken(connection: BankConnection): string | null {
  return connection.refreshTokenEncrypted ? decryptToken(connection.refreshTokenEncrypted) : null;
}
