ALTER TABLE "artworks" drop column "search_vector";--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', coalesce(title, '')), 'A') || setweight(to_tsvector('french', coalesce(description, '')), 'C')) STORED;--> statement-breakpoint
-- ⚠️ Dropping the generated column silently took its GIN index with it, and the
-- Drizzle snapshot still believes the index exists — so it is never re-created
-- on its own. Without this line the artwork search degrades to a sequential
-- scan, with no error to warn anybody.
CREATE INDEX IF NOT EXISTS "idx_artworks_search" ON "artworks" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "artworks" DROP COLUMN "artist_name";--> statement-breakpoint
ALTER TABLE "artworks" DROP COLUMN "artist_bio";--> statement-breakpoint
ALTER TABLE "artworks" DROP COLUMN "artist_image_url";