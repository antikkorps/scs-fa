CREATE TABLE "product_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "product_subcategories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "uq_product_subcategories_id_category" UNIQUE("id","category_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "subcategory_id" uuid;--> statement-breakpoint
ALTER TABLE "product_subcategories" ADD CONSTRAINT "product_subcategories_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_subcategories_category" ON "product_subcategories" USING btree ("category_id","display_order");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "fk_products_subcategory_category" FOREIGN KEY ("subcategory_id","category_id") REFERENCES "public"."product_subcategories"("id","category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_products_subcategory" ON "products" USING btree ("subcategory_id");