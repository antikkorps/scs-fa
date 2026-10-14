CREATE TABLE "henrri_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"refund_id" uuid,
	"kind" "henrri_document_kind" NOT NULL,
	"status" "henrri_document_status" DEFAULT 'pending' NOT NULL,
	"henrri_document_id" integer,
	"henrri_number" varchar(50),
	"expected_total_ttc" numeric(10, 2) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp,
	"finalized_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "henrri_documents_refund_id_unique" UNIQUE("refund_id"),
	CONSTRAINT "henrri_documents_henrri_document_id_unique" UNIQUE("henrri_document_id"),
	CONSTRAINT "henrri_documents_henrri_number_unique" UNIQUE("henrri_number"),
	CONSTRAINT "henrri_documents_refund_matches_kind" CHECK (("henrri_documents"."kind" = 'invoice') = ("henrri_documents"."refund_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_henrri_documents_order" ON "henrri_documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_henrri_documents_status" ON "henrri_documents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_henrri_documents_order_invoice" ON "henrri_documents" USING btree ("order_id") WHERE "henrri_documents"."kind" = 'invoice';