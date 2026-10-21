CREATE TYPE "public"."quote_request_status" AS ENUM('requested', 'in_review', 'sent', 'accepted', 'declined', 'expired', 'converted', 'cancelled');--> statement-breakpoint
CREATE SEQUENCE "public"."quote_request_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "quote_basket_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_quote_basket_qty" CHECK ("quote_basket_items"."qty" BETWEEN 1 AND 9999)
);
--> statement-breakpoint
CREATE TABLE "quote_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"product_sku" varchar(100) NOT NULL,
	"variant_sku" varchar(150),
	"variant_label" varchar(255),
	"legal_category" "legal_category",
	"qty" integer NOT NULL,
	"public_price_ht" numeric(10, 2) NOT NULL,
	"vat_pct" numeric(4, 2) NOT NULL,
	"quoted_price_ht" numeric(10, 2),
	"line_discount_pct" numeric(5, 2),
	CONSTRAINT "chk_quote_request_items_qty" CHECK ("quote_request_items"."qty" BETWEEN 1 AND 9999)
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(20) NOT NULL,
	"organisation_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"message" text,
	"status" "quote_request_status" DEFAULT 'requested' NOT NULL,
	"valid_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quote_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "quote_basket_items" ADD CONSTRAINT "quote_basket_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_basket_items" ADD CONSTRAINT "quote_basket_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_items" ADD CONSTRAINT "quote_request_items_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_items" ADD CONSTRAINT "quote_request_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_items" ADD CONSTRAINT "quote_request_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quote_basket_line" ON "quote_basket_items" USING btree ("user_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_quote_request_items_request" ON "quote_request_items" USING btree ("quote_request_id","position");--> statement-breakpoint
CREATE INDEX "idx_quote_requests_organisation" ON "quote_requests" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_quote_requests_status" ON "quote_requests" USING btree ("status");