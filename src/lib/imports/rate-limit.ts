import { createRateLimiter } from "@/lib/rate-limit";

// Parsing + merchant normalization + recurring-detection is real CPU work
// (an O(n) parse plus per-cluster date/amount statistics), so this is
// throttled more conservatively than a single cheap subscription create —
// closer to checkBillingPortalRateLimit's conservative-ceiling style for an
// expensive operation than checkSubscriptionCreateRateLimit's generous one.
const ANALYZE_LIMIT = 10;
const ANALYZE_WINDOW_MS = 60 * 60 * 1000;

export const checkImportAnalyzeRateLimit = createRateLimiter(ANALYZE_LIMIT, ANALYZE_WINDOW_MS);

// A separate limiter from checkSubscriptionCreateRateLimit (60/hr, in
// src/lib/subscriptions/rate-limit.ts) deliberately left untouched by bulk
// import — one import-confirm call can legitimately create 10-30 rows at
// once in a single request, a different abuse shape than that per-row
// limiter was built for.
const CONFIRM_LIMIT = 5;
const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

export const checkImportConfirmRateLimit = createRateLimiter(CONFIRM_LIMIT, CONFIRM_WINDOW_MS);

// Shared by every live-API provider's connect/sync routes (Plaid, TrueLayer)
// — a real outbound call to the provider's API each time, same conservative
// ceiling as ANALYZE_LIMIT rather than a per-provider limiter each, since a
// single user only ever has one bank connection flow in progress at a time.
const BANK_CONNECT_LIMIT = 10;
const BANK_CONNECT_WINDOW_MS = 60 * 60 * 1000;

export const checkBankConnectRateLimit = createRateLimiter(BANK_CONNECT_LIMIT, BANK_CONNECT_WINDOW_MS);

// Gmail's authorize/disconnect are cheap (no external API call yet) and
// share checkBankConnectRateLimit's "one connect flow at a time" ceiling —
// no separate limiter needed for those. Sync is different: it's a Gmail
// messages.list call plus up to MAX_MESSAGES_PER_SYNC messages.get calls
// (see gmail-extract.ts) each time, real outbound API cost per call closer
// to ANALYZE_LIMIT's "expensive operation" ceiling than a cheap CRUD
// action.
const GMAIL_SYNC_LIMIT = 10;
const GMAIL_SYNC_WINDOW_MS = 60 * 60 * 1000;

export const checkGmailSyncRateLimit = createRateLimiter(GMAIL_SYNC_LIMIT, GMAIL_SYNC_WINDOW_MS);

// A cheap, session-gated, read-your-own-data GET — generous ceiling, purely
// defense-in-depth (every other route in this file guards a real write or
// an outbound third-party call; this one guards against nothing more than
// an unbounded polling loop).
const HISTORY_LIMIT = 60;
const HISTORY_WINDOW_MS = 60 * 60 * 1000;

export const checkImportHistoryRateLimit = createRateLimiter(HISTORY_LIMIT, HISTORY_WINDOW_MS);
