import process from "node:process"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Integration tests share one Postgres; global views (e.g. the admin
    // review queue) make concurrent test files step on each other.
    fileParallelism: false,
    // Provision a throwaway test database (cloned from dev) before the run, so
    // tests never touch the dev DB / wipe the seeded demo admin. See
    // src/test/global-setup.ts.
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      // Run against the dedicated test database, never the dev one. A dedicated
      // var (TEST_DATABASE_URL) lets CI override without a stray DATABASE_URL leaking in.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://armurier:armurier_dev_password@localhost:5435/armurier_test",
      // Never hit a real bucket from tests, whatever the local .env says
      STORAGE_DRIVER: "memory",
      // Stripe is mocked in tests; these just satisfy env validation
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
      // Bank-transfer RIB is snapshotted onto orders; these satisfy validation
      VIREMENT_IBAN: "FR7630006000011234567890189",
      VIREMENT_BIC: "AGRIFRPP",
      VIREMENT_BANK_NAME: "Banque Test",
      VIREMENT_ACCOUNT_HOLDER: "SCS Firearm SAS",
    },
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: [
        "src/db/seeds.ts",
        "src/db/seed-cli.ts",
        "src/db/schema.ts",
        "src/legal-documents/sla-cli.ts",
        "**/*.test.ts",
      ],
    },
  },
})
