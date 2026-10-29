CREATE TYPE "public"."shop_launch_stage" AS ENUM('coming_soon', 'showcase', 'open');--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "launch_stage" "shop_launch_stage" DEFAULT 'coming_soon' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "indexing_enabled" boolean DEFAULT false NOT NULL;