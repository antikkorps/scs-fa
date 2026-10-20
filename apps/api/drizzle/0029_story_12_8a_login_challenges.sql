CREATE TABLE "login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp,
	"device_label" varchar(255),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "login_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_login_challenges_user" ON "login_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_login_challenges_expires" ON "login_challenges" USING btree ("expires_at");