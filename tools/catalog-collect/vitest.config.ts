import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Every test runs offline, against saved pages: a collector test must
    // never depend on — or hit — a supplier's live site.
    include: ["src/**/*.test.ts"],
  },
})
