import Aura from "@primevue/themes/aura"

/**
 * The back-office's PrimeVue theme (story 9.6), imported by the module's
 * plugin through `primevue.importTheme` in nuxt.config.ts.
 *
 * Passed inline as `primevue.options.theme`, the whole Aura preset landed in
 * the PUBLIC runtime config — serialised into every page of the site, ~125 KB
 * of inline script on pages that never use PrimeVue. Imported, it is plain
 * code, bundled with the plugin.
 */
export default {
  preset: Aura,
  options: {
    darkModeSelector: "system",
  },
}
