ALTER TABLE "catalog_imports" ADD COLUMN "archived_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_products_archived" ON "products" USING btree ("archived_at");