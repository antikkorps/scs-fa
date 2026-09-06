CREATE TYPE "public"."address_type" AS ENUM('shipping', 'billing', 'both');--> statement-breakpoint
CREATE TYPE "public"."doc_scan_status" AS ENUM('pending', 'clean', 'infected');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('cni', 'permis_chasse', 'autorisation_det', 'sia', 'expertise');--> statement-breakpoint
CREATE TYPE "public"."doc_verification_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."legal_category" AS ENUM('A', 'B', 'C', 'D', 'none');--> statement-breakpoint
CREATE TYPE "public"."order_legal_status" AS ENUM('pending', 'docs_verifying', 'docs_verified', 'docs_rejected', 'payment_pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'awaiting_transfer', 'transfer_claimed', 'received', 'reconciled', 'failed', 'cancelled', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."print_status" AS ENUM('available', 'in_cart', 'sold', 'reserved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('arme_ancienne', 'occasion', 'arme_longue', 'arme_poing', 'arme_defense', 'munition', 'accessoire_tireur', 'aide_visee', 'accessoire_autre', 'gun_art');--> statement-breakpoint
CREATE TYPE "public"."refund_channel" AS ENUM('carte', 'virement');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'vendor', 'admin');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(100),
	"type" "address_type" DEFAULT 'both' NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"line1" varchar(255) NOT NULL,
	"line2" varchar(255),
	"postal" varchar(10) NOT NULL,
	"city" varchar(100) NOT NULL,
	"country" varchar(2) DEFAULT 'FR' NOT NULL,
	"phone" varchar(20),
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ancient_weapons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"period" varchar(100),
	"period_start_year" integer,
	"period_end_year" integer,
	"provenance" varchar(500),
	"maker_name" varchar(255),
	"maker_location" varchar(255),
	"condition" varchar(50) NOT NULL,
	"condition_description" text,
	"restoration_info" text,
	"is_authentic" boolean DEFAULT false NOT NULL,
	"expert_name" varchar(255),
	"expert_certification_url" varchar(512),
	"expert_date" date,
	"historical_info" jsonb DEFAULT '{}'::jsonb,
	"is_unique" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ancient_weapons_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "artwork_cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"print_id" uuid NOT NULL,
	"price_ht_at_time" numeric(10, 2) NOT NULL,
	"added_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "artwork_prints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"print_number" integer NOT NULL,
	"total_prints" integer NOT NULL,
	"print_designation" varchar(50) NOT NULL,
	"format_id" varchar(100) NOT NULL,
	"price_ht_unit" numeric(10, 2) NOT NULL,
	"status" "print_status" DEFAULT 'available' NOT NULL,
	"order_id" uuid,
	"sold_at" timestamp,
	"sold_price_ttc" numeric(10, 2),
	"certificate_number" varchar(100),
	"certificate_url" varchar(512),
	"certificate_generated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "artwork_prints_certificate_number_unique" UNIQUE("certificate_number"),
	CONSTRAINT "chk_print_number" CHECK (print_number >= 1 AND print_number <= total_prints)
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" varchar(255) NOT NULL,
	"sku" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"long_description" text,
	"artist_name" varchar(255),
	"artist_bio" text,
	"artist_image_url" varchar(512),
	"edition_limit" integer NOT NULL,
	"edition_year" integer,
	"available_formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_price_ht" numeric(10, 2) NOT NULL,
	"price_increment_ht" numeric(8, 2) NOT NULL,
	"vat_pct" numeric(4, 2) DEFAULT '20',
	"certificate_template_url" varchar(512),
	"include_certificate" boolean DEFAULT true,
	"featured_image_url" varchar(512),
	"images_count" integer DEFAULT 0,
	"orientation" varchar(16) DEFAULT 'portrait' NOT NULL,
	"available_from" timestamp,
	"available_until" timestamp,
	"published" boolean DEFAULT false,
	"featured" boolean DEFAULT false,
	"meta_title" varchar(255),
	"meta_description" varchar(500),
	"keywords" varchar(500),
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', coalesce(title, '')), 'A') || setweight(to_tsvector('french', coalesce(artist_name, '')), 'B') || setweight(to_tsvector('french', coalesce(description, '')), 'C')) STORED,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "artworks_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "artworks_slug_unique" UNIQUE("slug"),
	CONSTRAINT "artworks_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_role" varchar(50),
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid,
	"action" varchar(50) NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"excerpt" text,
	"content" text NOT NULL,
	"author_id" uuid,
	"category" varchar(100),
	"tags" varchar(500),
	"featured_image_url" varchar(512),
	"meta_title" varchar(255),
	"meta_description" varchar(500),
	"published" boolean DEFAULT false,
	"featured" boolean DEFAULT false,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"price_ht_at_time" numeric(10, 2) NOT NULL,
	"added_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"henrri_invoice_number" varchar(50) NOT NULL,
	"henrri_sync_status" varchar(50) DEFAULT 'pending',
	"pdf_url" varchar(512),
	"pdf_generated_at" timestamp,
	"issued_at" timestamp,
	"due_date" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "invoices_henrri_invoice_number_unique" UNIQUE("henrri_invoice_number")
);
--> statement-breakpoint
CREATE TABLE "legal_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "legal_category" NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"requires_verification" boolean DEFAULT true NOT NULL,
	"min_age" integer DEFAULT 18,
	"required_doc_types" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "legal_categories_category_unique" UNIQUE("category")
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"doc_number" varchar(100),
	"s3_key" varchar(512) NOT NULL,
	"s3_url" varchar(512) NOT NULL,
	"mime_type" varchar(50),
	"file_size" integer,
	"scan_status" "doc_scan_status" DEFAULT 'pending' NOT NULL,
	"scanned_at" timestamp,
	"issued_at" date,
	"expires_at" date,
	"verification_status" "doc_verification_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"verified_by" uuid,
	"verification_notes" text,
	"rejection_reason" varchar(50),
	"verification_deadline" timestamp,
	"sla_breach_notified_at" timestamp,
	"uploaded_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"product_sku" varchar(100) NOT NULL,
	"variant_sku" varchar(150),
	"qty" integer NOT NULL,
	"price_ht_unit" numeric(10, 2) NOT NULL,
	"price_ht_total" numeric(10, 2) NOT NULL,
	"vat_pct" numeric(4, 2) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legal_verification_status" "order_legal_status" DEFAULT 'pending' NOT NULL,
	"legal_verified_at" timestamp,
	"legal_verified_by" uuid,
	"legal_rejection_reason" text,
	"legal_verification_deadline" timestamp,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"items_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_ht" numeric(10, 2) NOT NULL,
	"vat_amount" numeric(10, 2) NOT NULL,
	"total_ttc" numeric(10, 2) NOT NULL,
	"vip_discount_applied_pct" numeric(5, 2) DEFAULT '0',
	"vip_discount_amount" numeric(10, 2) DEFAULT '0',
	"promo_code" varchar(100),
	"promo_discount_amount" numeric(10, 2) DEFAULT '0',
	"shipping_method" varchar(50),
	"shipping_cost" numeric(8, 2) DEFAULT '0',
	"shipping_address_street" varchar(255),
	"shipping_address_postal" varchar(10),
	"shipping_address_city" varchar(100),
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"henrri_invoice_id" varchar(100),
	"henrri_sync_at" timestamp,
	"henrri_sync_status" varchar(50),
	"henrri_error_msg" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "orders_henrri_invoice_id_unique" UNIQUE("henrri_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "payment_carte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_ttc" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR',
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"last4" varchar(4),
	"brand" varchar(50),
	"processed_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_carte_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "payment_virements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_expected_ttc" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR',
	"iban_recipient" varchar(50) NOT NULL,
	"bic_recipient" varchar(11),
	"bank_name" varchar(255),
	"account_holder_name" varchar(255),
	"payment_reference" varchar(100),
	"payment_status" "payment_status" DEFAULT 'awaiting_transfer' NOT NULL,
	"client_reported_iban" varchar(50),
	"client_reported_date" date,
	"client_reported_amount" numeric(10, 2),
	"client_reported_ref" varchar(100),
	"client_notes" text,
	"amount_received_ttc" numeric(10, 2),
	"received_at" timestamp,
	"received_from_iban" varchar(50),
	"reconciled_at" timestamp,
	"reconciled_by" uuid,
	"reconciliation_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_virements_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payment_virements_payment_reference_unique" UNIQUE("payment_reference")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" "product_category" NOT NULL,
	"display_order" integer DEFAULT 0,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "product_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku_variant" varchar(150) NOT NULL,
	"finition" varchar(100),
	"munition" varchar(100),
	"couleur" varchar(100),
	"stock_qty" integer DEFAULT 0,
	"price_delta_ht" numeric(8, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "product_variants_sku_variant_unique" UNIQUE("sku_variant"),
	CONSTRAINT "chk_variant_attrs" CHECK (finition IS NOT NULL OR munition IS NOT NULL OR couleur IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(100) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"long_description" text,
	"category_id" uuid NOT NULL,
	"legal_category_id" uuid,
	"supplier_id" uuid,
	"supplier_sku" varchar(100),
	"supplier_price_ht" numeric(10, 2),
	"price_ht" numeric(10, 2) NOT NULL,
	"margin_pct" numeric(5, 2) DEFAULT '30',
	"cost_price_ht" numeric(10, 2),
	"vat_pct" numeric(4, 2) DEFAULT '20',
	"stock_qty" integer DEFAULT 0,
	"stock_alert_level" integer DEFAULT 5,
	"track_stock" boolean DEFAULT true,
	"requires_legal_verification" boolean NOT NULL,
	"age_min_required" integer,
	"has_accessory_restrictions" boolean DEFAULT false,
	"accessory_restriction_notes" text,
	"featured_image_url" varchar(512),
	"images_count" integer DEFAULT 0,
	"meta_title" varchar(255),
	"meta_description" varchar(500),
	"keywords" varchar(500),
	"published" boolean DEFAULT true,
	"featured" boolean DEFAULT false,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', coalesce(name, '')), 'A') || setweight(to_tsvector('french', coalesce(description, '')), 'B') || setweight(to_tsvector('french', coalesce(long_description, '')), 'C')) STORED,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"device_label" varchar(255),
	"last_used_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"family_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" "refund_channel" NOT NULL,
	"amount_ttc" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR',
	"reason" varchar(255),
	"notes" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"stripe_refund_id" varchar(255),
	"failure_reason" text,
	"initiated_by" uuid,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty_change" integer NOT NULL,
	"movement_type" varchar(50) NOT NULL,
	"reference_id" uuid,
	"reference_type" varchar(50),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact_email" varchar(255),
	"contact_phone" varchar(20),
	"default_margin_pct" numeric(5, 2) DEFAULT '30',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"firstname" varchar(100),
	"lastname" varchar(100),
	"phone" varchar(20),
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"legal_verified_at" timestamp,
	"legal_verified_by" uuid,
	"legal_rejection_reason" text,
	"legal_rejection_at" timestamp,
	"vip_status" varchar,
	"vip_discount_pct" numeric(5, 2) DEFAULT '0',
	"vip_eligible_since" timestamp,
	"vip_active" boolean DEFAULT false,
	"address_street" varchar(255),
	"address_postal" varchar(10),
	"address_city" varchar(100),
	"address_country" varchar(2) DEFAULT 'FR',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	"deleted_at" timestamp,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"rgpd_consent_at" timestamp,
	"rgpd_consent_version" varchar(20),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ancient_weapons" ADD CONSTRAINT "ancient_weapons_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_cart_items" ADD CONSTRAINT "artwork_cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_cart_items" ADD CONSTRAINT "artwork_cart_items_print_id_artwork_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."artwork_prints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_prints" ADD CONSTRAINT "artwork_prints_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_prints" ADD CONSTRAINT "artwork_prints_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_legal_verified_by_users_id_fk" FOREIGN KEY ("legal_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_carte" ADD CONSTRAINT "payment_carte_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_virements" ADD CONSTRAINT "payment_virements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_virements" ADD CONSTRAINT "payment_virements_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_legal_category_id_legal_categories_id_fk" FOREIGN KEY ("legal_category_id") REFERENCES "public"."legal_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_legal_verified_by_users_id_fk" FOREIGN KEY ("legal_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_addresses_user" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ancient_period" ON "ancient_weapons" USING btree ("period_start_year","period_end_year");--> statement-breakpoint
CREATE INDEX "idx_ancient_authentic" ON "ancient_weapons" USING btree ("is_authentic");--> statement-breakpoint
CREATE INDEX "idx_art_cart_user" ON "artwork_cart_items" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_print_per_user_cart" ON "artwork_cart_items" USING btree ("user_id","print_id");--> statement-breakpoint
CREATE INDEX "idx_prints_artwork" ON "artwork_prints" USING btree ("artwork_id");--> statement-breakpoint
CREATE INDEX "idx_prints_status" ON "artwork_prints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_prints_sold" ON "artwork_prints" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_print_per_artwork" ON "artwork_prints" USING btree ("artwork_id","print_number");--> statement-breakpoint
CREATE INDEX "idx_artworks_slug" ON "artworks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_artworks_published" ON "artworks" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_artworks_available" ON "artworks" USING btree ("available_from","available_until");--> statement-breakpoint
CREATE INDEX "idx_artworks_search" ON "artworks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_blog_slug" ON "blog_posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_blog_published" ON "blog_posts" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_blog_category" ON "blog_posts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_cart_user" ON "cart_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_order" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_henrri_number" ON "invoices" USING btree ("henrri_invoice_number");--> statement-breakpoint
CREATE INDEX "idx_legal_docs_user" ON "legal_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_legal_docs_status" ON "legal_documents" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "idx_legal_docs_expires" ON "legal_documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_legal_docs_sla_breach" ON "legal_documents" USING btree ("verification_deadline") WHERE "legal_documents"."verification_status" = 'pending' AND "legal_documents"."sla_breach_notified_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_user_doc_type" ON "legal_documents" USING btree ("user_id","doc_type") WHERE "legal_documents"."verification_status" = 'approved';--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_user" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_legal_status" ON "orders" USING btree ("legal_verification_status");--> statement-breakpoint
CREATE INDEX "idx_orders_payment_status" ON "orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "idx_orders_created" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_henrri" ON "orders" USING btree ("henrri_invoice_id");--> statement-breakpoint
CREATE INDEX "idx_password_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_password_reset_tokens_expires" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_payment_carte_order" ON "payment_carte" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_payment_carte_status" ON "payment_carte" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "idx_payments_order" ON "payment_virements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payment_virements" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "idx_variants_product" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_variants_sku" ON "product_variants" USING btree ("sku_variant");--> statement-breakpoint
CREATE INDEX "idx_products_category" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_products_legal_category" ON "products" USING btree ("legal_category_id");--> statement-breakpoint
CREATE INDEX "idx_products_slug" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_products_published" ON "products" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_products_requires_legal" ON "products" USING btree ("requires_legal_verification");--> statement-breakpoint
CREATE INDEX "idx_products_search" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_expires" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_order" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_status" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_stock_variant" ON "stock_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_stock_type" ON "stock_movements" USING btree ("movement_type");--> statement-breakpoint
CREATE INDEX "idx_stock_created" ON "stock_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_users_vip_status" ON "users" USING btree ("vip_status");