ALTER TYPE "public"."henrri_document_kind" ADD VALUE 'quotation';--> statement-breakpoint
ALTER TABLE "henrri_documents" DROP CONSTRAINT "henrri_documents_refund_matches_kind";--> statement-breakpoint
ALTER TABLE "henrri_documents" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD COLUMN "quote_request_id" uuid;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "billing_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "billing_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "billing_postal" varchar(10);--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "billing_city" varchar(100);--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "billing_country" varchar(2) DEFAULT 'FR' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "henrri_customer_id" integer;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "henrri_customer_fingerprint" text;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "shipping_portions" jsonb;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "total_ttc" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "documents_sufficient_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "documents_sufficient_by" uuid;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_henrri_documents_quote_in_flight" ON "henrri_documents" USING btree ("quote_request_id") WHERE "henrri_documents"."status" IN ('pending', 'draft');--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_henrri_customer_id_unique" UNIQUE("henrri_customer_id");--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_source_matches_kind" CHECK (("henrri_documents"."kind" IN ('invoice', 'credit_note')) = ("henrri_documents"."order_id" IS NOT NULL)
        AND ("henrri_documents"."order_id" IS NULL) <> ("henrri_documents"."quote_request_id" IS NULL));--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_refund_matches_kind" CHECK (("henrri_documents"."kind" = 'credit_note') = ("henrri_documents"."refund_id" IS NOT NULL));