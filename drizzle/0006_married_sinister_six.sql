-- Deduplicates existing rows before the unique constraint below is added —
-- 0005 only gave user_id a non-unique index, so any account that requested
-- more than one verification link before this migration ran could have
-- multiple outstanding token rows, which would make the ADD CONSTRAINT
-- below fail outright against real data. Keeps the newest row per user
-- (highest created_at, ties broken by id) and drops the rest; the newest
-- token is the one issueVerificationToken()'s own callers would actually
-- want honored anyway.
DELETE FROM "email_verification_tokens" a
USING "email_verification_tokens" b
WHERE a.user_id = b.user_id
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));--> statement-breakpoint
DROP INDEX "email_verification_tokens_user_idx";--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_unique" UNIQUE("user_id");