CREATE TABLE "shop_identity" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" varchar(200),
	"legal_form" varchar(100),
	"share_capital" varchar(100),
	"registration" varchar(200),
	"siret" varchar(14),
	"vat_number" varchar(50),
	"address" varchar(300),
	"email" varchar(255),
	"privacy_email" varchar(255),
	"phone" varchar(20),
	"publication_director" varchar(200),
	"firearms_trade_authorisation" varchar(300),
	"mediator_name" varchar(200),
	"mediator_url" varchar(500),
	"contact_hours" varchar(300),
	"contact_note" varchar(500),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_shop_identity_singleton" CHECK (id = 1)
);
--> statement-breakpoint
-- The single row, empty: every fact is still to supply (EMPTY_SHOP_IDENTITY in @armurier/shared).
INSERT INTO "shop_identity" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
