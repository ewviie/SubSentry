ALTER TABLE "users" ALTER COLUMN "weekly_digest_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_digest_monthly_cents" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_digest_currency" text;