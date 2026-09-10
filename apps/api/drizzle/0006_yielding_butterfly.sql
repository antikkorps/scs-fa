CREATE TYPE "public"."media_owner_type" AS ENUM('product', 'artwork', 'artwork_series', 'artist');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "media_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt" varchar(500) NOT NULL,
	"widths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"watermarked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_media_owner" ON "media" USING btree ("owner_type","owner_id","position");