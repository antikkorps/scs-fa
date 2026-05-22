import Aura from "@primevue/themes/aura"

export default defineNuxtConfig({
  compatibilityDate: "2026-02-07",
  devtools: { enabled: true },

  modules: ["@primevue/nuxt-module"],

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
      apiBase: process.env.API_BASE_URL ?? "http://localhost:8080/api",
    },
  },

  ssr: true,
})
