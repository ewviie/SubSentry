DROP INDEX "email_verification_tokens_user_idx";--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_unique" UNIQUE("user_id");