import "dotenv/config"
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // API
  API_PORT: z.coerce.number().default(8080),
  API_HOST: z.string().default("0.0.0.0"),

  // DB
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("1h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // Storage (provider-agnostic; "memory" uses an in-process store for tests/CI)
  STORAGE_DRIVER: z.enum(["s3", "memory"]).optional(),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string(),
  S3_REGION: z.string(),
  // Needed for S3-compatible providers (MinIO, some Scaleway setups)
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // SMTP
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  SMTP_FROM: z.string().email(),

  // Stripe (card payments). Webhook secret signs the events Stripe POSTs us.
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // Legal doc SLA breach scheduler — in-process check every N minutes (0 disables;
  // disabled in tests regardless). External cron can call the sla CLI instead.
  SLA_CHECK_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
})

export const env = envSchema.parse(process.env)
export type Env = z.infer<typeof envSchema>
