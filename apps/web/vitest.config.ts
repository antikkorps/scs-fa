import { defineVitestConfig } from "@nuxt/test-utils/config"

// `defineVitestConfig` registers the "nuxt" Vitest environment. Pure-logic and
// server tests default to "node" (fast); component/composable tests opt into the
// Nuxt runtime per file with a `// @vitest-environment nuxt` docblock.
export default defineVitestConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts", "app/**/*.{test,spec}.ts", "server/**/*.{test,spec}.ts"],
    // ⚠️ Booting the Nuxt runtime is genuinely slow, and 26 files ask for it.
    // Vitest's default 10s hook timeout is a laptop figure: the same suite takes
    // ~7s locally and ~173s on the CI runner, so `setupNuxt()` legitimately
    // overran there and a green run turned red without a line of code changing.
    // These ceilings exist to tell a SLOW boot apart from a HUNG one — they are
    // not a licence for slow tests.
    hookTimeout: 60_000,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
    },
  },
})
