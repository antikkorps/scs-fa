import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Integration tests share one Postgres; global views (e.g. the admin
    // review queue) make concurrent test files step on each other.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      // Never hit a real bucket from tests, whatever the local .env says
      STORAGE_DRIVER: "memory",
    },
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: ["src/db/seeds.ts", "src/db/seed-cli.ts", "src/db/schema.ts", "**/*.test.ts"],
    },
  },
})
