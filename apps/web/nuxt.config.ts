import { fileURLToPath } from "node:url"

// Keeps a page out of search indexes while letting crawlers follow its links.
const NOINDEX = { "x-robots-tag": "noindex, follow" }

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
    defaults: {
      subsets: ["latin"],
      styles: ["normal"],
      // Preload both files. The generated fallback faces are built on the
      // generic `serif`/`sans-serif`, which carry no measurable metrics, so
      // they ship `size-adjust: 100%`: on a slow connection the swap re-wrapped
      // the home page headline and cost 0.036 of CLS (measured, reproducible).
      // Preloading makes the real faces available at first paint, so there is
      // no swap to shift anything.
      preload: true,
    },
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
    // Story 9.6: never inline PrimeVue's CSS into server-rendered pages. By
    // default the module pushes the styles of EVERY component it registers
    // (datatable, datepicker, treetable…) into the <head> of every page —
    // ~470 KB on each public page, which uses none of them, and the cause of a
    // 7 s mobile LCP (measured). PrimeVue only serves the back-office, rendered
    // client-side (`ssr: false` below), where each component injects its own
    // styles as it mounts.
    loadStyles: false,
    // The theme is imported, not passed as an option: an option is copied into
    // the public runtime config, i.e. into every page (see app/primevue-theme.ts).
    importTheme: { as: "ScsPrimeVueTheme", from: fileURLToPath(new URL("./app/primevue-theme.ts", import.meta.url)) },
  },

  runtimeConfig: {
    // Server-only (story 9.6). The Nuxt server reaches the API over the private
    // network instead of going back out through Cloudflare, and says on whose
    // behalf it calls: see server/utils/upstream.ts. Both empty in dev, where
    // the public apiBase is already local.
    apiInternalBase: "",
    internalApiSecret: "",
    public: {
      // Dev API runs on 8081 (see apps/api/.env); override via API_BASE_URL in prod.
      apiBase: process.env.API_BASE_URL ?? "http://localhost:8081/api",
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
      // Stripe publishable key (public by design). Set via
      // NUXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in apps/web/.env.
      stripePublishableKey: "",
      // Umami website id (story 9.6), via NUXT_PUBLIC_UMAMI_WEBSITE_ID. Empty =
      // no measurement at all; set, the tracker still waits for consent.
      umamiWebsiteId: "",
      // Search Console ownership token (story 9.6), via
      // NUXT_PUBLIC_GOOGLE_SITE_VERIFICATION — the content of Google's
      // "HTML tag" method. Empty = no tag.
      googleSiteVerification: "",
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
    "/admin": { ssr: false, headers: NOINDEX },
    "/admin/**": { ssr: false, headers: NOINDEX },
    // Private or transactional pages (story 9.6): never in an index. A header
    // rather than a meta tag, so it also covers the redirects protected pages
    // answer, and a page that forgets its own tag. Not in robots.txt on purpose:
    // a disallowed URL is never fetched, so its noindex is never read.
    ...Object.fromEntries(
      [
        "/connexion",
        "/inscription",
        "/mot-de-passe-oublie",
        "/reset-password",
        "/panier",
        "/compte",
        "/compte/**",
        "/commande",
        "/commande/**",
        "/newsletter/**",
        "/recherche",
      ].map((path) => [path, { headers: NOINDEX }]),
    ),
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
      // Provisional monogram (story 9.6) until a real logo exists — files in public/.
      link: [
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
    },
  },

  ssr: true,
})
