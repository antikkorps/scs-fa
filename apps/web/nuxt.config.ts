import Aura from "@primevue/themes/aura"

export default defineNuxtConfig({
  compatibilityDate: "2026-02-07",
  devtools: { enabled: true },

  modules: ["@primevue/nuxt-module"],

  css: ["~/assets/css/main.css"],

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
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
        },
      ],
    },
  },

  ssr: true,
})
