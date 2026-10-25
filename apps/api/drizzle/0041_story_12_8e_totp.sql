CREATE TYPE "public"."login_challenge_method" AS ENUM('email_code', 'totp', 'totp_enrollment');--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_challenges" ALTER COLUMN "code_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "login_challenges" ADD COLUMN "method" "login_challenge_method" DEFAULT 'email_code' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recovery_codes_user" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recovery_codes_hash" ON "recovery_codes" USING btree ("user_id","code_hash");