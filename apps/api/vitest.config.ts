import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
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
