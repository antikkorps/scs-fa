CREATE TYPE "public"."tag_facet" AS ENUM('etat', 'epoque', 'caracteristique');--> statement-breakpoint
CREATE TABLE "product_tags" (
	"product_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "product_tags_product_id_tag_id_pk" PRIMARY KEY("product_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"facet" "tag_facet" NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
--> Data step, hand-added: `arme_ancienne` and `occasion` stop being categories
--> and become tags (story 11.1). Without this the cast back to the new enum
--> below fails on any database that still holds those rows.
--> Both carry zero products; the products.category_id foreign key is the guard —
--> if one were ever referenced this DELETE errors out instead of silently
--> orphaning a product.
DELETE FROM "product_categories" WHERE "category" IN ('arme_ancienne', 'occasion');--> statement-breakpoint
ALTER TABLE "product_categories" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."product_category";--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('arme_longue', 'arme_poing', 'arme_defense', 'munition', 'accessoire_tireur', 'aide_visee', 'accessoire_autre', 'gun_art');--> statement-breakpoint
ALTER TABLE "product_categories" ALTER COLUMN "category" SET DATA TYPE "public"."product_category" USING "category"::"public"."product_category";--> statement-breakpoint
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_tags_tag" ON "product_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_tags_facet" ON "tags" USING btree ("facet","display_order");