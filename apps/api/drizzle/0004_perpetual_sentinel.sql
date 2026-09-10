CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"headline" varchar(255),
	"bio" text,
	"journey" text,
	"portrait_url" varchar(512),
	"book_title" varchar(255),
	"book_url" varchar(512),
	"published" boolean DEFAULT false,
	"meta_title" varchar(255),
	"meta_description" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "artists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "artwork_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"intro" text,
	"reference" varchar(255),
	"theme_id" uuid,
	"artist_id" uuid,
	"cover_image_url" varchar(512),
	"display_order" integer DEFAULT 0,
	"published" boolean DEFAULT false,
	"meta_title" varchar(255),
	"meta_description" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "artwork_series_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "artwork_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "artwork_themes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "artist_id" uuid;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "series_order" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "artwork_series" ADD CONSTRAINT "artwork_series_theme_id_artwork_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."artwork_themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_series" ADD CONSTRAINT "artwork_series_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artists_slug" ON "artists" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_artwork_series_slug" ON "artwork_series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_artwork_series_theme" ON "artwork_series" USING btree ("theme_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_artwork_series_published" ON "artwork_series" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_artwork_themes_order" ON "artwork_themes" USING btree ("display_order");--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_series_id_artwork_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."artwork_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artworks_series" ON "artworks" USING btree ("series_id","series_order");--> statement-breakpoint
CREATE INDEX "idx_artworks_artist" ON "artworks" USING btree ("artist_id");--> statement-breakpoint
-- Backfill (story 11.6): the artist identity lived denormalised on every
-- artwork. Promote each distinct name to a row in `artists`, carrying over the
-- bio and portrait of whichever artwork holds them, then repoint the artworks
-- at it. Runs before 0005 drops the legacy columns.
--
-- The slug folds accents by hand rather than through `unaccent`: that extension
-- is not guaranteed to be installed, and a migration that fails on a fresh
-- database is worse than a slightly blunt transliteration.
INSERT INTO "artists" ("slug", "name", "bio", "portrait_url", "published")
SELECT
  btrim(
    regexp_replace(
      regexp_replace(
        lower(translate(src."name", 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                                    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
        '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'),
    '-'
  ) AS "slug",
  src."name",
  src."bio",
  src."portrait_url",
  true
FROM (
  SELECT
    "artist_name" AS "name",
    (array_agg("artist_bio" ORDER BY "artist_bio" IS NULL, "created_at"))[1] AS "bio",
    (array_agg("artist_image_url" ORDER BY "artist_image_url" IS NULL, "created_at"))[1] AS "portrait_url"
  FROM "artworks"
  WHERE "artist_name" IS NOT NULL AND btrim("artist_name") <> ''
  GROUP BY "artist_name"
) AS src
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
UPDATE "artworks" SET "artist_id" = "artists"."id"
FROM "artists" WHERE "artists"."name" = "artworks"."artist_name";
