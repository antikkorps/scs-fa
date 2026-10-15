CREATE TYPE "public"."refund_kind" AS ENUM('goods_return', 'goodwill', 'overpayment');--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "kind" "refund_kind" DEFAULT 'goodwill' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "includes_shipping" boolean DEFAULT false NOT NULL;