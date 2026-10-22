import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

// The environment as a production server loads it: its own process, run from an
// empty directory so no local .env fills the gaps (dotenv reads the cwd).
const emptyDir = mkdtempSync(join(tmpdir(), "env-check-"))
const TSX = resolve("node_modules/.bin/tsx")
const ENV_MODULE = resolve("src/env.ts")

const REAL_PRODUCTION = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://armurier:7f3c9a1e5b2d8f40@postgres:5432/armurier_prod",
  JWT_SECRET: "q8Zr2vK1fLw9Xs0PmB4tY7nH3cJ6gD5aE1uR8iO2pQ9w",
  JWT_REFRESH_SECRET: "Lm3Nb8Vc1Xz7Qw4Er9Ty2Ui6Op0As5Df3Gh8Jk1Lz4x",
  S3_ENDPOINT: "https://s3.fr-par.scw.cloud",
  S3_ACCESS_KEY: "SCWABCDEF0123456789",
  S3_SECRET_KEY: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  S3_BUCKET: "armurier-prod",
  S3_REGION: "fr-par",
  SMTP_HOST: "mail.ovh.net",
  SMTP_USER: "noreply@scs-firearms.com",
  SMTP_PASS: "s3cr3t-smtp-pass-from-ovh",
  SMTP_FROM: "noreply@scs-firearms.com",
  STRIPE_SECRET_KEY: "sk_live_51HxAbCdEf",
  STRIPE_WEBHOOK_SECRET: "whsec_9f8e7d6c5b4a",
  VIREMENT_IBAN: "FR7612345678901234567890123",
  VIREMENT_BIC: "AGRIFRPP",
  VIREMENT_BANK_NAME: "Banque",
  VIREMENT_ACCOUNT_HOLDER: "SCS Firearms SAS",
}

function loadEnv(overrides: Record<string, string>) {
  const result = spawnSync(TSX, [ENV_MODULE], {
    cwd: emptyDir,
    env: { PATH: process.env.PATH ?? "", ...REAL_PRODUCTION, ...overrides },
    encoding: "utf8",
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

afterAll(() => rmSync(emptyDir, { recursive: true, force: true }))

describe("production environment (story 12.9b)", () => {
  it("starts with real values", () => {
    expect(loadEnv({}).status).toBe(0)
  }, 30_000)

  it("refuses to start on a sample secret, and names it without printing it", () => {
    const { status, output } = loadEnv({
      JWT_SECRET: "CHANGE-ME-very-long-secret-min-32-chars",
      UMAMI_APP_SECRET: "CHANGE-ME-openssl-rand-hex-32",
    })
    expect(status).not.toBe(0)
    expect(output).toContain("JWT_SECRET")
    expect(output).toContain("UMAMI_APP_SECRET")
    expect(output).not.toContain("very-long-secret")
  }, 30_000)

  it("lets development run on the samples", () => {
    expect(loadEnv({ NODE_ENV: "development", JWT_SECRET: "CHANGE-ME-very-long-secret-min-32-chars" }).status).toBe(0)
  }, 30_000)
})
