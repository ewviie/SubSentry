# DATABASE_QUERY_AUDIT.md

> **⚠️ ARCHIVED — superseded by [SECURITY_STATUS.md](./SECURITY_STATUS.md) (2026-08-22).**
> Retained for historical narrative only. This file predates a full
> independent re-audit and 7-role adversarial council review that found
> several claims below stale or no longer accurate against current code
> (see SECURITY_STATUS.md for specifics and current verified state). Do not
> treat anything in this file as a current claim without re-checking it
> against the actual source first.

Full audit of every Drizzle query call site (`src/lib/*/queries.ts`, `src/lib/imports/bank-connections.ts`, all API routes) for N+1 patterns, missing joins, missing indexes, and redundant fetches. Method: grepped every `for`/`.map`/`.forEach` loop in the codebase for a DB call inside its body, and cross-referenced every `.where()`/`.orderBy()` clause against `schema.ts`'s indexes.

## Result: no N+1 query patterns found

Every loop in the codebase (`grep -rn "for ("` across `src/`) operates on data **already fetched in one query** and does pure in-memory computation — the correct pattern. Examples: `insights.ts`'s duplicate-detection double loop, `analytics.ts`'s category/billing-cycle aggregation, `savings.ts`'s recommendation scoring — all iterate an array already returned by a single `listSubscriptions(userId)` call, never issuing a query per iteration.

**One loop does call an external API per iteration**: `src/lib/imports/providers/truelayer-provider.ts:35` (`for (const account of accounts) { await fetchAccountTransactions(...) }`). This is a REST call to TrueLayer, not the app's own database — and it's structurally required: TrueLayer's Data API has no bulk "all accounts' transactions" endpoint (unlike Plaid's `/transactions/get`, which does — see that file's own comment). Not fixable without a bulk endpoint TrueLayer doesn't offer; already called out in-code, not a DB issue.

## Index coverage — every real query pattern checked

| Query | Where clause | Index used |
|---|---|---|
| `listSubscriptions` | `userId = ?` ORDER BY `nextRenewalDate` | `subscriptions_user_renewal_idx (userId, nextRenewalDate)` — exact match |
| `getSubscription`/`updateSubscription`/`deleteSubscription` | `userId = ? AND id = ?` | `id` is the primary key (unique index); `userId` filters on top — already optimal |
| `listImports` | `userId = ?` ORDER BY `createdAt DESC` | `imports_user_created_idx (userId, createdAt)` — exact match |
| `getImport` | `userId = ? AND id = ?` | `id` is the primary key |
| `getLatestBankConnection` | `userId = ? AND provider = ?` ORDER BY `createdAt DESC` | `bank_connections_user_idx (userId)` covers the equality filter; `provider`/`createdAt` aren't separately indexed |
| `listBankConnections` | `userId = ?` ORDER BY `createdAt DESC` | `bank_connections_user_idx (userId)` |
| `getSession` (join) | `sessions.tokenHash = ?` (INNER JOIN users) | `tokenHash` is unique-indexed; `users.id` is the join's PK side |
| `checkLockout`/`recordFailedLogin` | `email = ?` | `email` is the primary key |
| `consumeVerificationToken` | `tokenHash = ?` | `tokenHash` is unique-indexed |

**One minor, non-urgent observation**: `bank_connections_user_idx` covers `userId` alone, not `(userId, provider)`. Not a real problem today — this table has at most 1-2 rows per user (one per provider), so a sequential scan over a user's own tiny row set costs nothing regardless of index shape. Worth revisiting only if multi-institution support (several connections per provider per user) is added later. **No index added** — adding one now would be premature optimization against a query pattern that doesn't exist yet.

## Redundant-fetch check

Checked every route for the same data being fetched twice in one request. **None found** — e.g. `subscriptions/route.ts`'s two `listSubscriptions` calls are in separate handlers (`GET` and `POST`), not both hit in one request.

## Transactions

Already reviewed in `SECURITY_HARDENING_REPORT.md` — `billing/activate` and `stripe/webhook` wrap their multi-statement writes in `db.transaction`; `email-verification.ts`'s consume path does too (select + delete + user update, atomically).

## Conclusion

No fixes applied in this pass — the query layer was already clean. This audit exists as evidence, not as a checklist item satisfied by inventing a problem to solve.
