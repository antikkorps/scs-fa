ALTER TABLE "shipments" ADD COLUMN "tracking_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "tracking_label" varchar(255);