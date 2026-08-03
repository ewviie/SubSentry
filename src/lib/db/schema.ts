import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  date,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
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
    source: text("source", { enum: ["csv_import", "apple_import", "google_play_import"] }).notNull(),
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
export type Import = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert;
export type CheckoutSession = typeof checkoutSessions.$inferSelect;
