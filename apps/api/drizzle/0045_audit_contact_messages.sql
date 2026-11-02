CREATE TYPE "public"."contact_status" AS ENUM('new', 'handled');--> statement-breakpoint
CREATE TYPE "public"."contact_subject" AS ENUM('order', 'product', 'gun_art', 'pro_account', 'other');--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"subject" "contact_subject" NOT NULL,
	"order_reference" varchar(40),
	"message" text NOT NULL,
	"status" "contact_status" DEFAULT 'new' NOT NULL,
	"handled_at" timestamp,
	"handled_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contact_messages_status_created" ON "contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_contact_messages_email_created" ON "contact_messages" USING btree ("email","created_at");