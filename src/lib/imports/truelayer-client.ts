import { isTokenEncryptionConfigured } from "@/lib/security/token-encryption";

// TrueLayer has no official Node SDK (unlike Plaid) — this is a thin fetch()
// wrapper over its documented OAuth2 + Data API endpoints. Same "leave the
// keys unset and the feature stays hidden" pattern as plaid-client.ts.
const AUTH_BASE = { sandbox: "https://auth.truelayer-sandbox.com", live: "https://auth.truelayer.com" } as const;
const DATA_BASE = {
  sandbox: "https://api.truelayer-sandbox.com",
  live: "https://api.truelayer.com",
} as const;

// `offline_access` is what makes TrueLayer issue a refresh_token at all —
// without it the access token (which expires in ~90 minutes) can never be
// renewed, forcing the user to reconnect every session.
const SCOPES = "info accounts balance transactions offline_access";
// uk-ob-all/uk-oauth-all cover the UK Open Banking + supported card
// providers; TrueLayer's Auth API only returns providers relevant to the
// account holder's region regardless, so this is a safe broad default
// rather than a hard restriction.
const PROVIDERS = "uk-ob-all uk-oauth-all";

function env(): "sandbox" | "live" {
  return process.env.TRUELAYER_ENV === "live" ? "live" : "sandbox";
}

// A hung TrueLayer request (network stall, provider outage) would otherwise
// block the whole sync/connect route indefinitely — no timeout was ever set
// on any of these calls. AbortController + a bounded timer gives every
// TrueLayer request a hard ceiling; the timer is always cleared in
// `finally` so it never outlives the request that scheduled it.
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Also requires TOKEN_ENCRYPTION_KEY, same reasoning as plaid-client.ts's
// isPlaidConfigured() — without it, the callback route's createBankConnection
// call would fail to encrypt the token after the user already completed the
// OAuth consent screen.
export function isTrueLayerConfigured(): boolean {
  return (
    Boolean(process.env.TRUELAYER_CLIENT_ID && process.env.TRUELAYER_CLIENT_SECRET) && isTokenEncryptionConfigured()
  );
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TRUELAYER_CLIENT_ID/TRUELAYER_CLIENT_SECRET are not set. TrueLayer import is disabled without them.");
  }
  return { clientId, clientSecret };
}

export function buildAuthorizationUrl(redirectUri: string, state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    providers: PROVIDERS,
    state,
  });
  return `${AUTH_BASE[env()]}/?${params.toString()}`;
}

export interface TrueLayerTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

// Carries the HTTP status so callers can tell "this refresh token is dead,
// the user needs to reconnect" (400/401 from TrueLayer's token endpoint —
// typically invalid_grant) apart from a transient network/5xx failure that's
// actually worth retrying.
export class TrueLayerApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TrueLayerApiError";
    this.status = status;
  }
}

async function requestToken(body: Record<string, string>): Promise<TrueLayerTokens> {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetchWithTimeout(`${AUTH_BASE[env()]}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }).toString(),
  });
  if (!response.ok) {
    throw new TrueLayerApiError(`TrueLayer token request failed: ${response.status}`, response.status);
  }
  const data: TokenResponse = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TrueLayerTokens> {
  return requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshAccessToken(refreshToken: string): Promise<TrueLayerTokens> {
  return requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export interface TrueLayerAccount {
  account_id: string;
  display_name: string;
  provider: { display_name: string };
}

export async function fetchAccounts(accessToken: string): Promise<TrueLayerAccount[]> {
  const response = await fetchWithTimeout(`${DATA_BASE[env()]}/data/v1/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`TrueLayer accounts request failed: ${response.status}`);
  }
  const data: { results: TrueLayerAccount[] } = await response.json();
  return data.results;
}

export interface TrueLayerTransaction {
  transaction_id: string;
  timestamp: string;
  description: string;
  merchant_name?: string | null;
  amount: number;
  currency: string;
  transaction_type: string;
}

export async function fetchAccountTransactions(
  accessToken: string,
  accountId: string,
  fromISODate: string,
  toISODate: string,
): Promise<TrueLayerTransaction[]> {
  const params = new URLSearchParams({ from: fromISODate, to: toISODate });
  const response = await fetchWithTimeout(`${DATA_BASE[env()]}/data/v1/accounts/${accountId}/transactions?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`TrueLayer transactions request failed: ${response.status}`);
  }
  const data: { results: TrueLayerTransaction[] } = await response.json();
  return data.results;
}
