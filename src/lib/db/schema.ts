import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  index,
  uniqueIndex,
  jsonb,
  boolean,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { SUBSCRIPTION_SOURCES } from "@/lib/subscriptions/source";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  plan: text("plan", { enum: ["free", "pro"] }).notNull().default("free"),
  // Set from the Checkout Session's `customer` field once a Payment Link
  // checkout completes (see stripe/webhook/route.ts) — the only thing the
  // Billing Portal route needs to open a session, and how the webhook maps
  // a subscription-cancelled event back to a user without ever storing a
  // Stripe subscription id we'd otherwise have to keep in sync.
  stripeCustomerId: text("stripe_customer_id"),
  // Column-level default is `true`, not `false` — this backfills every
  // existing row (created before email verification existed) as already
  // verified, so this migration can't lock out current users. New signups
  // explicitly override this to `false` in the insert (see
  // api/auth/signup/route.ts); the column default only governs rows that
  // don't set it themselves.
  emailVerified: boolean("email_verified").notNull().default(true),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Default `true` (opt-out, not opt-in) — this is the one genuinely
  // debated default in this schema; see renewal-reminders.ts's own
  // top-of-file comment for the full reasoning and the mitigations that
  // exist specifically because of it (per-run recipient cap, one-click
  // unsubscribe with no login required). The short version: an attacker
  // who fully controls a fake account (see emailVerified's own comment —
  // signup doesn't confirm email ownership) can flip this toggle
  // themselves regardless of its default, so the default value doesn't
  // change attack feasibility either way; it only affects the "typo'd my
  // own email" case and general product norms (subscription trackers
  // conventionally default renewal reminders on). The real containment is
  // the per-run cap + unsubscribe link, not this default.
  renewalRemindersEnabled: boolean("renewal_reminders_enabled").notNull().default(true),
  // Notification preferences (product-value pass). Two different defaults
  // on purpose: priceAlertEmailsEnabled defaults true, same "opt-out, not
  // opt-in" convention renewalRemindersEnabled already uses — a price going
  // up is exactly the kind of thing a subscription tracker exists to catch,
  // so it should reach an inbox by default the same way a renewal heads-up
  // already does. weeklyDigestEnabled defaults FALSE: this is a genuinely
  // new, recurring email a user hasn't implicitly agreed to just by signing
  // up (unlike the other two, which fire only around a real event), so it
  // starts opt-in rather than silently enrolling every existing account in
  // a new weekly email the moment this ships.
  priceAlertEmailsEnabled: boolean("price_alert_emails_enabled").notNull().default(true),
  weeklyDigestEnabled: boolean("weekly_digest_enabled").notNull().default(false),
  // How many days before a renewal the reminder email (renewal-reminders.ts)
  // should fire — replaces the previously-fixed REMINDER_WINDOW_MAX_DAYS=3
  // for the *lead time* a user sees, while the underlying claim/send job
  // still only ever sends one email per renewal event (see renewal_reminders'
  // own schema comment). Constrained to a short curated list (not free
  // integer input) via the check constraint below and subscriptionInputSchema-
  // style Zod validation at the write path — same "the app already validated
  // this by construction" posture other enum-shaped text columns document
  // in the check constraints already on this table.
  renewalReminderLeadDays: integer("renewal_reminder_lead_days").notNull().default(3),
  // Tracks the weekly-digest cron job's own "have I already sent this
  // user's digest this week" state — the same reason renewalReminders got
  // its own table rather than trusting the cron's schedule alone: a
  // manually re-triggered run, a retried request, or a schedule that fires
  // twice in one calendar week must never double-send. Unlike
  // renewal_reminders (one row per renewal *event*, since a subscription
  // can have many), a digest is a per-user, recurring, dateless fact — "the
  // last time this user's digest went out" — so a single nullable
  // timestamp column on users is the right shape, not a whole new table.
  lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "users_renewal_reminder_lead_days_valid",
    sql`${table.renewalReminderLeadDays} in (1, 3, 7, 14, 30)`,
  ),
]);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    billingCycle: text("billing_cycle", {
      enum: ["monthly", "yearly", "weekly", "quarterly"],
    }).notNull(),
    category: text("category", {
      enum: [
        "streaming",
        "software",
        "fitness",
        "utilities",
        "finance",
        "news",
        "gaming",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    nextRenewalDate: date("next_renewal_date").notNull(),
    status: text("status", { enum: ["active", "paused", "canceled"] })
      .notNull()
      .default("active"),
    notes: text("notes"),
    source: text("source", { enum: SUBSCRIPTION_SOURCES })
      .notNull()
      .default("manual"),
    // Product-value pass: "when did a human last actually look at this
    // subscription's own page." Null for every subscription that existed
    // before this column shipped and for one nobody has opened since — no
    // fabricated backfill, same posture subscriptionPriceHistory's own
    // comment documents for why that table doesn't invent history either.
    // Deliberately NOT reusing updatedAt for this: updatedAt already moves
    // on any write to this row, including ones a human never looked at (an
    // import-confirmed price reconciliation, a future automated sync) — see
    // filters.ts's own comment on why this app is otherwise careful not to
    // introduce a persisted "reviewed" flag that could silently go stale or
    // misreport what's actually true. This column avoids that trap by only
    // ever being set from one real, deliberate signal: a GET of this
    // subscription's own detail page (see subscriptions/[id]/page.tsx),
    // which is the one page in this app whose entire purpose is reviewing a
    // single subscription — not a passive dashboard glance, not a
    // system-driven write.
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("subscriptions_user_status_idx").on(table.userId, table.status),
    index("subscriptions_user_renewal_idx").on(table.userId, table.nextRenewalDate),
    // Partial, userId-free — every other index on this table leads with
    // userId because every other query here is scoped to one user's own
    // subscriptions. The renewal-reminder cron job is the first query in
    // this codebase that scans *across* users by renewal date; the
    // existing indexes can't serve a userId-agnostic range scan
    // efficiently. `WHERE status = 'active'` keeps it small — paused/
    // canceled rows, which the reminder job already excludes, never
    // bloat this index in the first place.
    index("subscriptions_active_renewal_idx")
      .on(table.nextRenewalDate)
      .where(sql`${table.status} = 'active'`),
    // Defense in depth, not a replacement for subscriptionInputSchema
    // (validation.ts) — that's still what runs first and produces a real
    // 400 with a helpful message on a bad request. These exist because
    // Drizzle's `{ enum: [...] }` on a `text` column (billingCycle,
    // category, status above) is TypeScript-only: it constrains what this
    // codebase's own queries can *write* through the type system, but
    // Postgres itself never rejected an out-of-set value before this —
    // confirmed by reading the actual generated migration SQL, which
    // create these as plain `text NOT NULL` with no CHECK at all. Any
    // future write path that reaches this table without going through
    // validation.ts (a raw query, a script, a bug in a new API route)
    // would have been accepted silently. amountCents >= 0, not > 0: $0.00
    // is a real, allowed value (a free trial or promo subscription — see
    // price-history.ts's own comment on this), never negative.
    check("subscriptions_amount_cents_non_negative", sql`${table.amountCents} >= 0`),
    check(
      "subscriptions_billing_cycle_valid",
      sql`${table.billingCycle} in ('monthly', 'yearly', 'weekly', 'quarterly')`,
    ),
    check("subscriptions_status_valid", sql`${table.status} in ('active', 'paused', 'canceled')`),
    check(
      "subscriptions_category_valid",
      sql`${table.category} in ('streaming', 'software', 'fitness', 'utilities', 'finance', 'news', 'gaming', 'other')`,
    ),
  ],
);

// One row per renewal-reminder *event* the cron job has claimed or sent —
// see src/lib/subscriptions/renewal-reminders.ts for the full job. The
// unique (subscriptionId, renewalDate) pair is deliberately the identity
// of "one renewal event," not "one email": if a subscription's
// nextRenewalDate changes (user edits it, or it rolls forward after
// renewing), that's a genuinely new event and gets its own row —
// old rows are left in place as history, never edited or reused for a
// different date.
//
// Two-phase state, not a single "sent" boolean: `claimedAt` is set the
// moment a row is inserted (before any email is attempted); `sentAt`
// stays null until the SMTP send actually succeeds. This split exists
// because an email send can't be wrapped in the same DB transaction as
// the claim (unlike stripeEvents' onConflictDoNothing-in-one-transaction
// pattern, which this table's *shape* otherwise mirrors) — if the send
// fails after the claim already committed, sentAt staying null is what
// lets a later job run recognize this row as "claimed but never
// delivered" and safely retry it (see claimReminder's own comment for
// the exact reclaim condition), instead of the unique constraint
// silently blocking every future attempt forever.
//
// userId is denormalized here rather than reached via
// subscriptionId -> subscriptions.userId -> users.email — this table
// exists specifically to drive "who do we email," so storing the
// recipient's owning user id directly avoids a join on the one query
// this table is for, at the cost of one extra column kept in sync by
// construction (set once, at insert, never updated).
export const renewalReminders = pgTable(
  "renewal_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    renewalDate: date("renewal_date").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("renewal_reminders_subscription_date_idx").on(table.subscriptionId, table.renewalDate),
  ],
);

// One row per completed Import Center confirm action (see
// src/lib/imports/queries.ts). Written only once the user has reviewed and
// confirmed a batch — never at analyze time — so there's no "abandoned
// mid-review" row to garbage-collect. Uploaded file content itself is never
// stored anywhere; this table is purely a small audit summary (counts +
// bounded error list), not a place raw import data lives.
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: ["csv_import", "apple_import", "google_play_import", "plaid_import", "truelayer_import", "gmail_import"],
    }).notNull(),
    status: text("status", { enum: ["reviewed", "completed", "failed"] })
      .notNull()
      .default("completed"),
    detectedCount: integer("detected_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    ignoredCount: integer("ignored_count").notNull().default(0),
    // Small and bounded (capped at ~20 entries before insert, see
    // src/lib/imports/queries.ts) — a structured summary, not a dump of raw
    // parser internals.
    errors: jsonb("errors").$type<{ row?: number; message: string }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("imports_user_created_idx").on(table.userId, table.createdAt)],
);

// One row per linked bank/institution via a live-API import provider
// (Plaid, TrueLayer) — see src/lib/imports/providers/plaid-provider.ts and
// truelayer-provider.ts. Distinct from `imports` (a one-time audit record
// written after a confirm): this is a standing, reusable credential the
// analyze/sync routes read from on every fetch. Tokens are stored encrypted
// (see src/lib/security/token-encryption.ts) since, unlike a session token,
// they must be decryptable to actually call the provider's API later.
export const bankConnections = pgTable(
  "bank_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["plaid", "truelayer"] }).notNull(),
    // The provider's own stable identifier for this linked
    // institution/account (Plaid's item_id, TrueLayer's account id) — used
    // to detect a duplicate re-link of the same institution.
    providerItemId: text("provider_item_id").notNull(),
    institutionName: text("institution_name"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    // Only TrueLayer's OAuth tokens expire and need this (~90 min access
    // token lifetime); Plaid's access tokens don't expire the same way, so
    // its provider never populates these two columns.
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Watchdog phase: mirrors emailConnections' own lastSyncedAt (see that
    // column's comment) — distinct from updatedAt (which also moves on a
    // token refresh). Drives the sync cron's own candidate ordering
    // (oldest/never-synced first, nulls-first), the same fair-rotation
    // reasoning weekly-digest-job.ts's own findDigestCandidates already
    // documents: without this, a bounded per-run cap would always process
    // the same connections first forever once account count exceeds it.
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bank_connections_user_idx").on(table.userId),
    index("bank_connections_last_synced_idx").on(table.lastSyncedAt),
    // Scoped by userId, not just (provider, providerItemId) — the invariant
    // is "this user hasn't already linked this institution," not "no user
    // in the system has ever linked this exact id." A global-only unique
    // index would throw on legitimate re-links whenever a provider's id
    // isn't as globally unique as assumed (e.g. sandbox test data).
    uniqueIndex("bank_connections_user_provider_item_idx").on(
      table.userId,
      table.provider,
      table.providerItemId,
    ),
  ],
);

// One row per linked mailbox via a live-API import provider (Gmail today)
// — see src/lib/imports/gmail-client.ts. Deliberately a separate table from
// bankConnections rather than widening its `provider` enum: the shape
// genuinely differs (emailAddress instead of institutionName; no
// providerItemId — a user only ever has one Gmail connection at a time in
// this design, so (userId, provider) alone is the uniqueness key, unlike
// bank_connections which supports multiple institutions per user) and
// conflating "a linked bank account" with "a linked mailbox" under one
// table would make both harder to read for no real code reuse (the actual
// reusable logic — AES-256-GCM token encryption — already lives in
// src/lib/security/token-encryption.ts, shared by both). Same
// encrypted-at-rest reasoning as bankConnections: an access/refresh token
// here must be decryptable to actually call the Gmail API later.
export const emailConnections = pgTable(
  "email_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["gmail"] }).notNull(),
    // The mailbox address this connection reads from — shown in the
    // "Connected as ___" UI state so a user can tell which account is
    // linked without needing to disconnect first to check.
    emailAddress: text("email_address").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    // Google's OAuth access tokens expire in ~1 hour; refresh_token is only
    // ever issued on the first consent (access_type=offline + prompt=consent
    // — see gmail-client.ts), so this can be null on a re-consent Google
    // silently treats as already-granted.
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Distinct from updatedAt (which also changes on every token refresh) —
    // this only moves when a sync actually ran, so the UI's "Last synced"
    // state reflects real scan activity, not incidental token housekeeping.
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_connections_user_provider_idx").on(table.userId, table.provider),
  ],
);

// DB-backed brute-force tracking, keyed by the normalized login email —
// deliberately NOT in-memory like src/lib/rate-limit.ts's limiters. A
// lockout is a security control, not just abuse-shedding: it must survive a
// process restart and be shared across horizontally-scaled instances, or an
// attacker defeats it just by outlasting/round-robining processes. One row
// per email that has ever failed a login; a clean login resets it to zero
// rather than leaving stale failure history.
export const loginAttempts = pgTable("login_attempts", {
  email: text("email").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per outstanding email-verification token. Truly single-use: a
// successful verification deletes its row (src/lib/auth/email-verification.ts)
// rather than flagging it used, so there's no "used" state to accidentally
// treat as still-valid. Only the sha256 hash is ever stored — same
// reasoning as sessions.tokenHash: a DB leak alone can't hand out a working
// verification link.
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Unique, not just indexed: issueVerificationToken() upserts on this
    // column (see src/lib/auth/email-verification.ts) so "issue a fresh
    // token" is one atomic statement instead of a separate delete then
    // insert — the prior two-statement version left a window where two
    // concurrent issue calls for the same user (e.g. a double-clicked
    // resend) could both land a row, leaving more than one valid link
    // outstanding at once. The unique constraint is what makes the upsert's
    // ON CONFLICT target well-defined; it also makes "at most one
    // outstanding token per user" a DB-enforced invariant, not just a
    // convention this module happens to follow.
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// One row per outstanding password-reset token — same single-use,
// hash-only-storage, upsert-on-userId pattern as emailVerificationTokens
// above (see its own comment for the full reasoning; not repeated here).
// A separate table rather than a shared one: the two token kinds have
// different consumers (consumeVerificationToken flips emailVerified;
// consumePasswordResetToken sets a new passwordHash and revokes every
// existing session for the user) and a real password-reset link is a
// higher-value target than a verification link, so it gets its own
// shorter TTL (see TOKEN_TTL_MS in lib/auth/password-reset.ts) rather than
// inheriting whatever TTL email verification happens to use.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const checkoutSessions = pgTable("checkout_sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email"),
  status: text("status", { enum: ["pending", "completed", "activated"] })
    .notNull()
    .default("pending"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// Phase 9: price-history capture. Phase 7.2/8's own DETECTION_MATRIX.md
// documented this as the #1 known limitation — `subscriptions.amountCents`
// only ever stores the current price, so "did this go up?" was previously
// unanswerable from stored data. This table starts real, incremental
// capture from the moment this ships: one row per price this subscription
// has actually had, written at creation ("initial") and again only when an
// edit genuinely changes amountCents, billingCycle, or currency
// ("user_edit") — see queries.ts's updateSubscription for the exact
// change-detection. It does NOT backfill fabricated history for existing
// subscriptions (there is no real prior price to record — only what's in
// front of us right now), so a subscription created before this migration
// starts with a single "initial" row the first time it's read after
// deploy, same as a brand-new one. Detection built on top of this (e.g.
// subscription-summary.tsx's price-change section) is honestly gated on
// having 2+ distinct-monthly-equivalent rows for real, not on this table
// merely existing.
//
// billingCycle is stored alongside amountCents, not assumed constant —
// amountCents alone is unit-less without it ("$10" means something very
// different at monthly vs. yearly cadence), and a user switching a
// subscription from monthly to annual billing genuinely changes what
// they're paying even when amountCents looks similar or even goes down.
// Every comparison across rows normalizes through money.ts's monthlyCents
// using each row's own billingCycle (see price-history.ts's
// computeLatestPriceChange) rather than assuming the cycle never changes
// between two rows.
//
// userId is denormalized here rather than reached via subscriptionId ->
// subscriptions.userId, same tradeoff renewalReminders documents on itself
// above: this table exists to answer "this user's price history for this
// subscription," so storing the owner directly keeps every read trivially
// scoped (no join needed to enforce ownership) at the cost of one extra
// column kept in sync by construction (set once, at insert, never updated
// — a subscription's owner never changes after creation).
//
// CodeRabbit review raised that subscriptionId and userId are two
// independent FKs, not a DB-enforced pairing — nothing at the schema level
// stops a row claiming subscription A belongs to a different user than A's
// real owner. Evaluated and kept as two independent FKs, matching
// renewalReminders' own identical, already-shipped tradeoff above: every
// write path in queries.ts derives userId from the exact same
// already-`requireUser()`-scoped subscription row it's writing
// amountCents/billingCycle from (never a caller-supplied, independently-
// trusted value), so there is no live path that could actually write a
// mismatched pair today. A DB-enforced composite FK would need a new
// unique(subscriptions.id, subscriptions.userId) constraint on an
// already-shipped, heavily-indexed table for a guarantee application code
// already provides by construction — real defense-in-depth, but a bigger
// change than this finding's actual risk justifies right now.
export const subscriptionPriceHistory = pgTable(
  "subscription_price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    billingCycle: text("billing_cycle", {
      enum: ["monthly", "yearly", "weekly", "quarterly"],
    }).notNull(),
    currency: text("currency").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    // "initial": the row written the moment a subscription is created (by
    // any source — manual, import, quick-add). "user_edit": amountCents,
    // billingCycle, or currency genuinely changed via the edit form/API.
    // "import_update": same PATCH write path as "user_edit" (updateSubscription,
    // queries.ts), but the user explicitly confirmed an import-detected
    // price-reconciliation proposal (review-table.tsx's "Update price")
    // rather than editing the form directly — see detection.ts's
    // priceChangeProposal for how that proposal is computed. Plain `text`,
    // no DB check constraint, so adding this required no migration.
    source: text("source", { enum: ["initial", "user_edit", "import_update"] }).notNull(),
  },
  (table) => [
    index("subscription_price_history_subscription_idx").on(table.subscriptionId, table.observedAt),
    index("subscription_price_history_user_idx").on(table.userId),
    // Same defense-in-depth reasoning as subscriptions' own checks above —
    // a negative or out-of-enum row here would silently corrupt
    // computeLatestPriceChange's "price increased/decreased" math (it has
    // no reason to distrust what's already in this table). `source`
    // deliberately has no check here — see its own column comment on why.
    check("subscription_price_history_amount_cents_non_negative", sql`${table.amountCents} >= 0`),
    check(
      "subscription_price_history_billing_cycle_valid",
      sql`${table.billingCycle} in ('monthly', 'yearly', 'weekly', 'quarterly')`,
    ),
  ],
);

// One row per savings recommendation a user has dismissed from their own
// /savings review list (see savings-recommendation-card.tsx's "Dismiss"
// button — before this table existed, that button only set local React
// state, so a dismissed finding silently came back on the very next page
// load with no record it had ever been acted on). recommendationId is
// computeSavingsRecommendations' own deterministic id string (e.g.
// "duplicate-<idA>-<idB>"), not a subscription FK: a recommendation is
// often about a *pair* of subscriptions, not one, and this id already
// encodes whichever ones are involved. No FK integrity needed against
// subscriptions — if the underlying subscription(s) are later
// canceled/deleted, computeSavingsRecommendations simply stops generating
// that id at all (it only ever reads from active subscriptions), so an
// orphaned dismissal row here is inert, never a dangling reference a query
// could trip over.
//
// Deliberately scoped to the /savings recommendation list only — it does
// not exclude the same underlying finding from the health score, the
// dashboard's "Your biggest opportunity"/"Savings opportunities" cards, or
// Quick Wins. Those surfaces state facts about the portfolio (score,
// dollar totals), not a personal to-do list; dismissing "stop asking me
// about this on my review list" should not quietly make a real duplicate
// invisible to the number that's supposed to reflect it honestly.
export const dismissedSavingsRecommendations = pgTable(
  "dismissed_savings_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recommendationId: text("recommendation_id").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dismissed_savings_recommendations_user_rec_idx").on(table.userId, table.recommendationId),
  ],
);

// Product-value pass: the persistent Notification/Intelligence Center. Every
// row here is a real, already-detected conclusion this app can back up —
// nothing is generated by this table's own write path; it only ever
// persists what lib/notifications/generate.ts computed from data that's
// already real (price history, savings recommendations, renewal dates,
// review timestamps — see that file's own header comment for the full
// "never fabricate" posture this mirrors from savings.ts/insights.ts).
//
// dedupeKey is what makes generation idempotent and spam-free: each
// generator builds a key from the real event's own identity (e.g.
// `price_increase:<subscriptionId>:<observedAtIso>`, mirroring
// subscriptionPriceHistory's own row identity), so re-running generation on
// every dashboard/notifications page load — the same "compute on read"
// posture insights.ts/savings.ts already use — can never insert the same
// real event twice. The unique index below is what makes that an atomic
// onConflictDoNothing rather than a read-then-write race.
//
// subscriptionId is nullable with onDelete "set null" (not "cascade", unlike
// every other subscriptions FK in this file): a notification is a historical
// fact ("Adobe's price went up on this date") that stays true and worth
// keeping in a user's own notification history even after the underlying
// subscription is later deleted — only the deep link stops resolving, which
// the UI handles by just not rendering a broken link, not by losing the
// notification.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "price_increase",
        "upcoming_renewal",
        "stale_subscription",
        "unusual_charge",
        "savings_opportunity",
        "duplicate_subscription",
        // Watchdog phase: an active subscription whose nextRenewalDate has
        // passed without the date being updated — the one renewal-adjacent
        // case actually worth an interrupt (see this file's own generate.ts
        // comment on why plain upcoming renewals no longer generate a
        // notification at all: they belong to the calendar/dashboard/digest,
        // not a feed). "upcoming_renewal" is kept in this enum, unused going
        // forward, rather than removed — this column has no DB check
        // constraint (see the impactCents check below for the one that does
        // exist), so dropping a value has no migration to make it safe
        // anyway, and any historical row already written with it stays
        // valid to read.
        "renewal_lapsed",
      ],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: text("severity", { enum: ["info", "warning"] }).notNull().default("info"),
    // Real dollar figure behind this notification where one exists (a price
    // increase's annual delta, a savings recommendation's impact) — null,
    // not 0, for the types that genuinely have no dollar figure to show
    // (stale_subscription), same "null is an honest gap, not a fabricated
    // number" rule savings.ts's SavingsTease already follows.
    impactCents: integer("impact_cents"),
    currency: text("currency"),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    // The deep-link path the UI should navigate to on click — e.g.
    // "/subscriptions/{id}" or "/savings". A plain string, not reconstructed
    // from subscriptionId at read time, so a notification whose subscription
    // was since deleted still remembers where it used to point (and the UI
    // can choose not to render it as a link once the subscription is gone,
    // rather than guessing).
    actionHref: text("action_href"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_user_dedupe_idx").on(table.userId, table.dedupeKey),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    // Partial, unread-only — same "keep the hot-path index small" reasoning
    // subscriptions_active_renewal_idx already documents on itself: the
    // unread count/list is read on every page load (it drives the bell
    // badge), while read notifications, the overwhelming majority over
    // time, never need to be found by this query again.
    index("notifications_user_unread_idx").on(table.userId).where(sql`${table.readAt} is null`),
    check("notifications_impact_cents_non_negative", sql`${table.impactCents} is null or ${table.impactCents} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type RenewalReminder = typeof renewalReminders.$inferSelect;
export type Import = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert;
export type BankConnection = typeof bankConnections.$inferSelect;
export type NewBankConnection = typeof bankConnections.$inferInsert;
export type EmailConnection = typeof emailConnections.$inferSelect;
export type NewEmailConnection = typeof emailConnections.$inferInsert;
export type CheckoutSession = typeof checkoutSessions.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type SubscriptionPriceHistory = typeof subscriptionPriceHistory.$inferSelect;
export type NewSubscriptionPriceHistory = typeof subscriptionPriceHistory.$inferInsert;
export type DismissedSavingsRecommendation = typeof dismissedSavingsRecommendations.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
