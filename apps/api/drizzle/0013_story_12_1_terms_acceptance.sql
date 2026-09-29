ALTER TABLE "orders" ADD COLUMN "terms_version" varchar(32);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "terms_accepted_at" timestamp;