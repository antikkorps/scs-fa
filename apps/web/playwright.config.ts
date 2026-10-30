import { defineConfig, devices } from "@playwright/test"

// Layout checks (e2e/): every public page, at three widths, against the
// production build of the site and an API seeded with the e2e fixtures.
// `pnpm --filter @armurier/web test:layout` — builds the site first.
//
// Dedicated ports, so a dev API (8081) or site (3000) left running never gets
// tested by mistake.
export const WEB_ORIGIN = "http://localhost:3091"
export const API_ORIGIN = "http://localhost:8091"

const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: CI,
  // A page that breaks once on CI breaks for visitors too: no retry hides it.
  retries: 0,
  workers: CI ? 2 : undefined,
  reporter: [["list"]],
  use: { baseURL: WEB_ORIGIN, ...devices["Desktop Chrome"] },
  projects: [
    // The rules proven on hand-built pages — once, they set their own viewport.
    { name: "rules", testMatch: "layout-rules.spec.ts" },
    ...[
      { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
      { name: "tablet-768", use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
      { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
    ].map((project) => ({ ...project, testMatch: "pages.spec.ts" })),
  ],
  webServer: [
    {
      // Seeds then serves in one process: its images live in memory (see apps/api/src/e2e/server.ts).
      command: "pnpm --filter @armurier/api e2e:server",
      url: `${API_ORIGIN}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        STORAGE_DRIVER: "memory",
        API_PORT: "8091",
        // Locally the throwaway test database (rebuilt by every `pnpm test`), never dev.
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          process.env.TEST_DATABASE_URL ??
          "postgresql://armurier:armurier_dev_password@localhost:5435/armurier_test",
      },
    },
    {
      command: "node .output/server/index.mjs",
      url: WEB_ORIGIN,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PORT: "3091",
        NUXT_PUBLIC_SITE_URL: WEB_ORIGIN,
        // Single origin, as in production: the browser asks the site for /api,
        // the e2e fixture forwards it to the API the way Caddy does.
        NUXT_PUBLIC_API_BASE: `${WEB_ORIGIN}/api`,
        NUXT_API_INTERNAL_BASE: `${API_ORIGIN}/api`,
      },
    },
  ],
})
