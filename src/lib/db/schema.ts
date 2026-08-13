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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bank_connections_user_idx").on(table.userId),
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
