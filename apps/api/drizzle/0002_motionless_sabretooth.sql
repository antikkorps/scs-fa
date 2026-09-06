ALTER TABLE "product_variants" ADD COLUMN "reserved_by" uuid;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "reserved_until" timestamp;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_reserved_by_users_id_fk" FOREIGN KEY ("reserved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;