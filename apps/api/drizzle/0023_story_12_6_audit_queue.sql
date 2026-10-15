ALTER TABLE "henrri_documents" DROP CONSTRAINT "henrri_documents_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "henrri_documents" DROP CONSTRAINT "henrri_documents_refund_id_refunds_id_fk";
--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD COLUMN "held_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "henrri_customer_fingerprint" text;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "henrri_documents" ADD CONSTRAINT "henrri_documents_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;