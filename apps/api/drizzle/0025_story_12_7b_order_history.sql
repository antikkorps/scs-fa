CREATE TYPE "public"."audit_result" AS ENUM('success', 'failure');--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "req_id" varchar(200);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "result" "audit_result" DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "error" varchar(100);--> statement-breakpoint
UPDATE "audit_logs" AS a SET "order_id" = o."id" FROM "orders" AS o WHERE a."order_id" IS NULL AND COALESCE(a."new_value"->>'orderId', a."old_value"->>'orderId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AND o."id" = COALESCE(a."new_value"->>'orderId', a."old_value"->>'orderId')::uuid;--> statement-breakpoint
UPDATE "audit_logs" AS a SET "order_id" = o."id" FROM "orders" AS o WHERE a."order_id" IS NULL AND a."entity_type" = 'order' AND o."id" = a."entity_id";--> statement-breakpoint
UPDATE "audit_logs" AS a SET "order_id" = s."order_id" FROM "shipments" AS s WHERE a."order_id" IS NULL AND a."entity_type" = 'shipment' AND s."id" = a."entity_id";--> statement-breakpoint
UPDATE "audit_logs" AS a SET "order_id" = r."order_id" FROM "refunds" AS r WHERE a."order_id" IS NULL AND a."entity_type" = 'refund' AND r."id" = a."entity_id";--> statement-breakpoint
UPDATE "audit_logs" AS a SET "order_id" = p."order_id" FROM "payment_carte" AS p WHERE a."order_id" IS NULL AND a."entity_type" = 'payment_carte' AND p."id" = a."entity_id";--> statement-breakpoint
UPDATE "audit_logs" AS a SET "order_id" = p."order_id" FROM "payment_virements" AS p WHERE a."order_id" IS NULL AND a."entity_type" = 'payment_virement' AND p."id" = a."entity_id";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_order" ON "audit_logs" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_req" ON "audit_logs" USING btree ("req_id");