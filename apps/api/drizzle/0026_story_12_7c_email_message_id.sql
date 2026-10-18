ALTER TABLE "audit_logs" ADD COLUMN "message_id" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_audit_message" ON "audit_logs" USING btree ("message_id");