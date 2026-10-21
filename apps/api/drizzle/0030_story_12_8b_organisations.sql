CREATE TYPE "public"."organisation_registry_check" AS ENUM('verified', 'inactive', 'not_found', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."organisation_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."organisation_type" AS ENUM('armurier', 'club', 'securite_privee', 'administration');--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"siret" varchar(14) NOT NULL,
	"type" "organisation_type" NOT NULL,
	"status" "organisation_status" DEFAULT 'pending' NOT NULL,
	"registry_check" "organisation_registry_check" NOT NULL,
	"registry_snapshot" jsonb,
	"registry_checked_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"review_reason" text,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"net30_allowed" boolean DEFAULT false NOT NULL,
	"show_prices" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_organisations_discount_pct" CHECK ("organisations"."discount_pct" >= 0 AND "organisations"."discount_pct" <= 100)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_organisations_siret_open" ON "organisations" USING btree ("siret") WHERE "organisations"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "idx_organisations_status" ON "organisations" USING btree ("status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_organisation" ON "users" USING btree ("organisation_id");