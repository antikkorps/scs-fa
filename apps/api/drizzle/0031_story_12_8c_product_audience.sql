CREATE TYPE "public"."product_audience" AS ENUM('public', 'pro');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "audience" "product_audience" DEFAULT 'public' NOT NULL;