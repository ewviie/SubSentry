import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { isTokenEncryptionConfigured } from "@/lib/security/token-encryption";

// Mirrors src/lib/billing/plan.ts's "leave the key unset and the feature
// stays hidden" pattern — PLAID_CLIENT_ID/PLAID_SECRET absent means the
// Plaid connect flow never renders, everything else in the app still works.
// Also requires TOKEN_ENCRYPTION_KEY (see src/lib/security/token-encryption.ts)
// since a Plaid access token is useless to store if it can never be
// decrypted back out again — without this check the source picker would
// show Plaid as available, only for the connect flow to fail after the user
// already completed Plaid Link, the moment the exchange route tries (and
// fails) to encrypt the returned access token.
export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) && isTokenEncryptionConfigured();
}

let cached: PlaidApi | undefined;

// Lazy singleton, same reasoning as src/lib/db/index.ts's `db` proxy: this
// module is imported by route handlers that Next.js's build step loads to
// collect metadata, so constructing the client eagerly at module scope
// would require PLAID_CLIENT_ID/PLAID_SECRET to exist at build time on any
// machine, even one that never uses this feature.
export function getPlaidClient(): PlaidApi {
  if (cached) return cached;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID/PLAID_SECRET are not set. Plaid import is disabled without them.");
  }

  const env = process.env.PLAID_ENV || "sandbox";
  const configuration = new Configuration({
    basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  cached = new PlaidApi(configuration);
  return cached;
}
