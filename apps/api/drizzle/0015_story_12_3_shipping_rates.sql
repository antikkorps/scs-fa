CREATE TABLE "shipping_rates" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"firearm_parcel_ttc" numeric(8, 2) NOT NULL,
	"small_parcel_ttc" numeric(8, 2) NOT NULL,
	"small_parcel_free_from_ttc" numeric(10, 2),
	"print_ttc" numeric(8, 2) NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_shipping_rates_singleton" CHECK (id = 1),
	CONSTRAINT "chk_shipping_rates_non_negative" CHECK (firearm_parcel_ttc >= 0 AND small_parcel_ttc >= 0 AND print_ttc >= 0 AND (small_parcel_free_from_ttc IS NULL OR small_parcel_free_from_ttc >= 0))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_ht" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- Default grid (DEFAULT_SHIPPING_RATES in @armurier/shared), to be replaced by the client's from the back office.
INSERT INTO "shipping_rates" ("id", "firearm_parcel_ttc", "small_parcel_ttc", "small_parcel_free_from_ttc", "print_ttc") VALUES (1, 25.00, 8.90, 150.00, 15.00) ON CONFLICT ("id") DO NOTHING;
