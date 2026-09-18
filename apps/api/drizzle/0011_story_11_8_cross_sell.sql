CREATE TABLE "product_cross_sells" (
	"product_id" uuid NOT NULL,
	"accessory_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "product_cross_sells_product_id_accessory_id_pk" PRIMARY KEY("product_id","accessory_id"),
	CONSTRAINT "chk_product_cross_sells_not_self" CHECK (product_id <> accessory_id)
);
--> statement-breakpoint
ALTER TABLE "product_cross_sells" ADD CONSTRAINT "product_cross_sells_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cross_sells" ADD CONSTRAINT "product_cross_sells_accessory_id_products_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_cross_sells_accessory" ON "product_cross_sells" USING btree ("accessory_id");