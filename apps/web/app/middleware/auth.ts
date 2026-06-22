// Route guard for any signed-in area of the storefront (account, checkout…).
// Role-agnostic: it only requires a session. Runs on server and client so a
// deep link or reload is gated before the page renders. Pages opt in with
// `definePageMeta({ middleware: "auth" })`.
export default defineNuxtRouteMiddleware((to) => {
  const token = useCookie<string | null>("scs_token")

  if (!token.value) {
    return navigateTo(`/connexion?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
