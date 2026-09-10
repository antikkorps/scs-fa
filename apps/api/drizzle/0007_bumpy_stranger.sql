CREATE TYPE "public"."beneficiary_kind" AS ENUM('artist', 'advisor');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'due', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" "beneficiary_kind" NOT NULL,
	"default_share_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"contact_email" varchar(255),
	"payment_notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "beneficiaries_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "beneficiary_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"variant_id" uuid,
	"print_id" uuid,
	"label" varchar(255) NOT NULL,
	"share_pct" numeric(5, 2) NOT NULL,
	"base_ht" numeric(10, 2) NOT NULL,
	"amount_ht" numeric(10, 2) NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"paid_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "beneficiary_id" uuid;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "cost_price_ht" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "charges_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "charges_amount_ht" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "beneficiary_share_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "charges_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "charges_amount_ht" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "beneficiary_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "beneficiary_share_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "beneficiary_payouts" ADD CONSTRAINT "beneficiary_payouts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_payouts" ADD CONSTRAINT "beneficiary_payouts_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_beneficiaries_active" ON "beneficiaries" USING btree ("active","name");--> statement-breakpoint
CREATE INDEX "idx_payouts_beneficiary" ON "beneficiary_payouts" USING btree ("beneficiary_id","status");--> statement-breakpoint
CREATE INDEX "idx_payouts_order" ON "beneficiary_payouts" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE set null ON UPDATE no action;