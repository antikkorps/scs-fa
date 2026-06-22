import { defineVitestConfig } from "@nuxt/test-utils/config"

// `defineVitestConfig` registers the "nuxt" Vitest environment. Pure-logic and
// server tests default to "node" (fast); component/composable tests opt into the
// Nuxt runtime per file with a `// @vitest-environment nuxt` docblock.
export default defineVitestConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts", "app/**/*.{test,spec}.ts", "server/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
  },
})
