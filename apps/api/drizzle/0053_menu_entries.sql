CREATE TYPE "public"."menu_entry_kind" AS ENUM('filter', 'group', 'link');--> statement-breakpoint
CREATE TABLE "menu_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" varchar(100) NOT NULL,
	"label" varchar(100) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" "menu_entry_kind" DEFAULT 'filter' NOT NULL,
	"link_url" varchar(500),
	"category_id" uuid,
	"subcategory_id" uuid,
	"legal_category" "legal_category",
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "uq_menu_entries_parent_slug" UNIQUE NULLS NOT DISTINCT("parent_id","slug"),
	CONSTRAINT "chk_menu_entries_subcategory_category" CHECK ("menu_entries"."subcategory_id" IS NULL OR "menu_entries"."category_id" IS NOT NULL),
	CONSTRAINT "chk_menu_entries_link" CHECK (("menu_entries"."kind" = 'link') = ("menu_entries"."link_url" IS NOT NULL)),
	CONSTRAINT "chk_menu_entries_filter" CHECK ("menu_entries"."kind" = 'filter' OR ("menu_entries"."category_id" IS NULL AND "menu_entries"."legal_category" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "menu_entry_tags" (
	"entry_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "menu_entry_tags_entry_id_tag_id_pk" PRIMARY KEY("entry_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "menu_entries" ADD CONSTRAINT "fk_menu_entries_parent" FOREIGN KEY ("parent_id") REFERENCES "public"."menu_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_entries" ADD CONSTRAINT "fk_menu_entries_category" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_entries" ADD CONSTRAINT "fk_menu_entries_subcategory_category" FOREIGN KEY ("subcategory_id","category_id") REFERENCES "public"."product_subcategories"("id","category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_entry_tags" ADD CONSTRAINT "fk_menu_entry_tags_entry" FOREIGN KEY ("entry_id") REFERENCES "public"."menu_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_entry_tags" ADD CONSTRAINT "fk_menu_entry_tags_tag" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_menu_entries_parent" ON "menu_entries" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "idx_menu_entry_tags_tag" ON "menu_entry_tags" USING btree ("tag_id");