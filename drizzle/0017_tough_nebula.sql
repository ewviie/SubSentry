CREATE TABLE "realized_savings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"subscription_name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"billing_cycle" text NOT NULL,
	"currency" text NOT NULL,
	"subscription_source" text NOT NULL,
	"canceled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realized_savings_amount_cents_non_negative" CHECK ("realized_savings"."amount_cents" >= 0),
	CONSTRAINT "realized_savings_billing_cycle_valid" CHECK ("realized_savings"."billing_cycle" in ('monthly', 'yearly', 'weekly', 'quarterly'))
);
--> statement-breakpoint
ALTER TABLE "realized_savings" ADD CONSTRAINT "realized_savings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_savings" ADD CONSTRAINT "realized_savings_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "realized_savings_subscription_idx" ON "realized_savings" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "realized_savings_user_canceled_idx" ON "realized_savings" USING btree ("user_id","canceled_at");