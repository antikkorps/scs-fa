CREATE TYPE "public"."catalog_image_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "catalog_import_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"url" varchar(1024) NOT NULL,
	"position" integer NOT NULL,
	"status" "catalog_image_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"error" text,
	"media_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"overwrite" boolean DEFAULT false NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"suppliers_created" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand" varchar(100);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ean" varchar(14);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_url" varchar(1024);--> statement-breakpoint
ALTER TABLE "catalog_import_images" ADD CONSTRAINT "catalog_import_images_import_id_catalog_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."catalog_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_import_images" ADD CONSTRAINT "catalog_import_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_import_images" ADD CONSTRAINT "catalog_import_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_catalog_import_images_product_url" ON "catalog_import_images" USING btree ("product_id","url");--> statement-breakpoint
CREATE INDEX "idx_catalog_import_images_status" ON "catalog_import_images" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_catalog_imports_created_at" ON "catalog_imports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_products_supplier_sku" ON "products" USING btree ("supplier_id","supplier_sku");--> statement-breakpoint
CREATE INDEX "idx_products_ean" ON "products" USING btree ("ean");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_suppliers_name_ci" ON "suppliers" USING btree (lower("name"));