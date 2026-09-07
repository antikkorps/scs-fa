CREATE TYPE "public"."newsletter_segment" AS ENUM('armurerie', 'collection', 'gun_art');--> statement-breakpoint
CREATE TYPE "public"."newsletter_subscription_status" AS ENUM('pending', 'confirmed', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."newsletter_token_purpose" AS ENUM('confirm', 'unsubscribe');--> statement-breakpoint
CREATE TABLE "newsletter_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"email_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"unsubscribed_at" timestamp,
	CONSTRAINT "newsletter_contacts_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriptions" (
	"contact_id" uuid NOT NULL,
	"segment" "newsletter_segment" NOT NULL,
	"status" "newsletter_subscription_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"unsubscribed_at" timestamp,
	"consent_source" varchar(255),
	"consent_ip" varchar(45),
	"consent_user_agent" text,
	"provider_synced_at" timestamp,
	CONSTRAINT "newsletter_subscriptions_contact_id_segment_pk" PRIMARY KEY("contact_id","segment")
);
--> statement-breakpoint
CREATE TABLE "newsletter_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" "newsletter_token_purpose" NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "newsletter_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_contact_id_newsletter_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."newsletter_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_tokens" ADD CONSTRAINT "newsletter_tokens_contact_id_newsletter_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."newsletter_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_newsletter_contacts_email" ON "newsletter_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_newsletter_subscriptions_segment" ON "newsletter_subscriptions" USING btree ("segment","status");--> statement-breakpoint
CREATE INDEX "idx_newsletter_tokens_contact" ON "newsletter_tokens" USING btree ("contact_id","purpose");