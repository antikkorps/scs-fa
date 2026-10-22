CREATE TABLE "shop_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"vip_margin_share_pct" numeric(5, 2) DEFAULT '50' NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_shop_settings_singleton" CHECK (id = 1),
	CONSTRAINT "chk_shop_settings_vip_share" CHECK (vip_margin_share_pct >= 0 AND vip_margin_share_pct <= 100)
);
--> statement-breakpoint
-- The single row, at the default share (DEFAULT_VIP_MARGIN_SHARE_PCT in @armurier/shared).
INSERT INTO "shop_settings" ("id", "vip_margin_share_pct") VALUES (1, 50.00) ON CONFLICT ("id") DO NOTHING;
