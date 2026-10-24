ALTER TABLE "refunds" ADD COLUMN "idempotency_key" varchar(64);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key");