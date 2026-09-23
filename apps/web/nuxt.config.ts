import Aura from "@primevue/themes/aura"

export default defineNuxtConfig({
  compatibilityDate: "2026-02-07",
  devtools: { enabled: true },

  modules: ["@primevue/nuxt-module", "@nuxt/fonts"],

  // `tokens.css` carries the design tokens (colour, type scale, layout) and
  // must load first: `main.css` and every `<style scoped>` consume it.
  css: ["~/assets/css/tokens.css", "~/assets/css/main.css"],

  // Self-hosted fonts (story 10.7). They used to come from Google Fonts: a
  // render-blocking third-party stylesheet on first paint, and every visitor's
  // IP handed to Google — a known and avoidable GDPR exposure. @nuxt/fonts
  // downloads the woff2 at build time and serves them from our own origin,
  // with `font-display: swap` and preloading of the critical files. No
  // outbound request is left at runtime.
  fonts: {
    defaults: { subsets: ["latin"], styles: ["normal"] },
    families: [
      // Fraunces replaces Cormorant Garamond: same "gallery" register, but an
      // x-height that holds down to 14px (cf. tokens.css § 2.1).
      { name: "Fraunces", provider: "google", weights: [400, 600, 700] },
      { name: "Inter", provider: "google", weights: [400, 500, 600, 700] },
    ],
    // Both families are named only in `--font-display` / `--font-body`:
    // without this the scanner would not see them anywhere.
    experimental: { processCSSVariables: true },
  },

  primevue: {
    options: {
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: "system",
        },
      },
    },
  },

  runtimeConfig: {
    public: {
      // Dev API runs on 8081 (see apps/api/.env); override via API_BASE_URL in prod.
      apiBase: process.env.API_BASE_URL ?? "http://localhost:8081/api",
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
      // Stripe publishable key (public by design). Set via
      // NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in apps/web/.env.
      stripePublishableKey: "",
    },
  },

  // The back-office is a private, authenticated tool: it needs neither SSR nor
  // SEO. Rendering it on the server only produced hydration warnings — every
  // admin page loads through `useAsyncData({ server: false })`, so the server
  // shipped the empty/error state ("Aucune commande pour ces critères",
  // "Commande introuvable") while the client showed "Chargement…". Serving the
  // shell alone removes the mismatch at its root, and spares the server the work.
  // `/admin/**` does not match `/admin` itself — the dashboard needs its own rule.
  routeRules: {
    "/admin": { ssr: false },
    "/admin/**": { ssr: false },
  },

  // Dev only: relative `/api/**` (e.g. blog image URLs embedded in articles)
  // resolve to the API origin. In production a single origin (Caddy) routes /api,
  // so no proxy is needed there. `useFetch` uses the absolute apiBase and bypasses this.
  nitro: {
    devProxy: {
      // Nitro strips the matched "/api" prefix, so the target must re-add it:
      // /api/blog/images/x → <apiBase>/blog/images/x.
      "/api": {
        target: process.env.API_BASE_URL ?? "http://localhost:8081/api",
        changeOrigin: true,
      },
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: "fr" },
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "theme-color", content: "#0e0e10" },
        { name: "format-detection", content: "telephone=no" },
      ],
    },
  },

  ssr: true,
})
