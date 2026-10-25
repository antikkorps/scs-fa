CREATE TYPE "public"."order_payment_terms" AS ENUM('immediate', 'net30');--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'agrement_armurier';--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'autorisation_commerce';--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'affiliation_federale';--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'autorisation_prefectorale';--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'autorisation_cnaps';--> statement-breakpoint
ALTER TYPE "public"."doc_type" ADD VALUE 'bon_de_commande';--> statement-breakpoint
ALTER TABLE "legal_documents" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD COLUMN "validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "quote_request_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_terms" "order_payment_terms" DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "chorus_service_code" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "chorus_commitment_number" varchar(100);--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "accepted_ip" varchar(45);--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."quote_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_organisation_doc_type" ON "legal_documents" USING btree ("organisation_id","doc_type") WHERE "legal_documents"."verification_status" = 'approved';--> statement-breakpoint
CREATE INDEX "idx_legal_docs_organisation" ON "legal_documents" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_quote_request_live" ON "orders" USING btree ("quote_request_id") WHERE "orders"."payment_status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "chk_legal_docs_owner" CHECK (("legal_documents"."user_id" IS NULL) <> ("legal_documents"."organisation_id" IS NULL));