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

  // Bank transfer (virement) — the SCS receiving account printed on the RIB we
  // hand the customer for regulated-firearm orders (Story 6.2). Snapshotted onto
  // each payment_virement row at order creation, so changing these later does
  // not rewrite instructions already issued.
  VIREMENT_IBAN: z.string().min(1),
  VIREMENT_BIC: z.string().min(1),
  VIREMENT_BANK_NAME: z.string().min(1),
  VIREMENT_ACCOUNT_HOLDER: z.string().min(1),

  // Legal doc SLA breach scheduler — in-process check every N minutes (0 disables;
  // disabled in tests regardless). External cron can call the sla CLI instead.
  SLA_CHECK_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),

  // Observability (Story 7.2). LOG_LEVEL overrides the per-env default (silent in
  // test, info in prod, debug locally). Server errors (5xx) email the admins,
  // throttled per error signature to avoid alert storms; alerts are off outside
  // production unless explicitly enabled (so dev/staging don't hit SMTP).
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  ERROR_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(15),
  ERROR_ALERTS_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  // Partner commission rate (Story 7.3). Shown transparently on the admin metrics
  // dashboard as the partner's share of net revenue. Percent, default 5%.
  COMMISSION_RATE_PCT: z.coerce.number().min(0).max(100).default(5),
})

export const env = envSchema.parse(process.env)
export type Env = z.infer<typeof envSchema>
