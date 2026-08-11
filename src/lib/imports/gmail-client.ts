import { isTokenEncryptionConfigured } from "@/lib/security/token-encryption";

// Google has no first-party Node SDK dependency this app already carries
// (unlike Plaid) — same thin fetch()-over-documented-REST-endpoints
// approach as truelayer-client.ts, not a new googleapis dependency for
// three endpoints.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
// Google's standard OAuth2 token revocation endpoint (RFC 7009) — revoking
// either an access or a refresh token invalidates the whole grant behind
// it, so disconnect.ts prefers the refresh token when one exists.
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Minimal permissions, deliberately: gmail.readonly (not gmail.modify or
// full mail.google.com) — read-only, can't send/delete/modify anything.
// "openid email" is only for userinfo's own email address (shown in the
// "Connected as ___" UI state), not for authentication — this app's own
// session system is unrelated to and unaffected by this OAuth grant.
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly openid email";

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

// Also requires TOKEN_ENCRYPTION_KEY, same reasoning as
// truelayer-client.ts's isTrueLayerConfigured() — without it, the callback
// route's createEmailConnection call would fail to encrypt the token after
// the user already completed Google's consent screen.
export function isGmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && isTokenEncryptionConfigured();
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set. Gmail import is disabled without them.");
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
    state,
    access_type: "offline", // required for Google to issue a refresh_token at all
    prompt: "consent", // forces the consent screen (and a refresh_token) even on a repeat authorization — without it, a returning user who already granted access once gets no refresh_token on a reconnect, silently breaking future syncs once the access token expires
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
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

export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

async function requestToken(body: Record<string, string>): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }).toString(),
  });
  if (!response.ok) {
    throw new GoogleApiError(`Google token request failed: ${response.status}`, response.status);
  }
  const data: TokenResponse = await response.json();
  return {
    accessToken: data.access_token,
    // Google only returns refresh_token on the authorization this consent
    // was actually granted on (see prompt=consent above) — a refresh call
    // never gets a new one, so callers must carry the original forward.
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  return requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

// Best-effort: called by disconnect/route.ts AFTER the local connection row
// is already deleted, never before — so a Google outage or a network blip
// here can't block the one guarantee that route exists to provide (this app
// can no longer use the token). A non-2xx/network failure is swallowed by
// the caller, not retried or surfaced to the user; the token still expires
// naturally even if this never reaches Google, same as it always did before
// this function existed.
export async function revokeToken(token: string): Promise<void> {
  const response = await fetchWithTimeout(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  if (!response.ok) {
    throw new GoogleApiError(`Google token revocation failed: ${response.status}`, response.status);
  }
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const response = await fetchWithTimeout(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new GoogleApiError(`Google userinfo request failed: ${response.status}`, response.status);
  }
  const data: { email?: string } = await response.json();
  if (!data.email) {
    throw new Error("Google userinfo response had no email address.");
  }
  return data.email;
}

export interface GmailMessageSummary {
  id: string;
}

// gmail.readonly's messages.list only ever returns message ids — the
// actual content is a separate per-message fetch (fetchMessage below).
// Bounded to maxResults so one sync can't balloon into hundreds of
// individual message fetches; a subscription receipt search is inherently
// a small slice of a real inbox, not most of it.
export async function searchMessages(accessToken: string, query: string, maxResults: number): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const response = await fetchWithTimeout(`${GMAIL_API_BASE}/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new GoogleApiError(`Gmail messages.list failed: ${response.status}`, response.status);
  }
  const data: { messages?: GmailMessageSummary[] } = await response.json();
  return data.messages ?? [];
}

export interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  internalDate: string; // epoch millis, as a string — Gmail's own API shape
  snippet: string;
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessagePart[];
  };
}

export async function fetchMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: "full" });
  const response = await fetchWithTimeout(`${GMAIL_API_BASE}/messages/${id}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new GoogleApiError(`Gmail messages.get failed: ${response.status}`, response.status);
  }
  return response.json();
}
