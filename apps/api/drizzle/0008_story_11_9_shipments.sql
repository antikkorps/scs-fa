CREATE TYPE "public"."order_shipping_status" AS ENUM('unshipped', 'partially_shipped', 'shipped', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('preparing', 'shipped', 'delivered');--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"variant_id" uuid,
	"print_id" uuid,
	"label" varchar(255) NOT NULL,
	"qty" integer NOT NULL,
	"part" integer DEFAULT 1 NOT NULL,
	"parts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "chk_shipment_items_ref" CHECK ((variant_id IS NULL) <> (print_id IS NULL)),
	CONSTRAINT "chk_shipment_items_split" CHECK (qty >= 1 AND parts BETWEEN 1 AND 5 AND part BETWEEN 1 AND parts)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"carrier" varchar(50) NOT NULL,
	"tracking_number" varchar(100),
	"tracking_url" varchar(512),
	"status" "shipment_status" DEFAULT 'preparing' NOT NULL,
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"notified_at" timestamp,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_status" "order_shipping_status" DEFAULT 'unshipped' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "parcel_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shipment_items_shipment" ON "shipment_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shipments_order_position" ON "shipments" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "idx_shipments_status" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_orders_shipping_status" ON "orders" USING btree ("shipping_status");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "chk_products_parcel_count" CHECK (parcel_count BETWEEN 1 AND 5);