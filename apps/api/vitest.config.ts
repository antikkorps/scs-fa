import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    env: {
      NODE_ENV: "test",
    },
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      exclude: ["src/db/seeds.ts", "src/db/seed-cli.ts", "src/db/schema.ts", "**/*.test.ts"],
    },
  },
})
