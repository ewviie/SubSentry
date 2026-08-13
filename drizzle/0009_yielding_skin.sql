CREATE TABLE "renewal_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"renewal_date" date NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "renewal_reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "renewal_reminders" ADD CONSTRAINT "renewal_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_reminders" ADD CONSTRAINT "renewal_reminders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_reminders_subscription_date_idx" ON "renewal_reminders" USING btree ("subscription_id","renewal_date");--> statement-breakpoint
CREATE INDEX "subscriptions_active_renewal_idx" ON "subscriptions" USING btree ("next_renewal_date") WHERE "subscriptions"."status" = 'active';