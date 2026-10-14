CREATE TYPE "public"."henrri_document_kind" AS ENUM('invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."henrri_document_status" AS ENUM('pending', 'draft', 'finalized', 'blocked');--> statement-breakpoint
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "invoices" CASCADE;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_henrri_invoice_id_unique";--> statement-breakpoint
DROP INDEX "idx_orders_henrri";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "henrri_customer_id" integer;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "henrri_invoice_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "henrri_sync_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "henrri_sync_status";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "henrri_error_msg";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_henrri_customer_id_unique" UNIQUE("henrri_customer_id");