import type { AuthUser } from "~/types/admin"

// Route guard for any signed-in area of the storefront (account, checkout…).
// Role-agnostic: it only requires a session. The session tokens are httpOnly, so
// this UX gate reads the non-secret `scs_user` cookie; the API enforces auth on
// every request. Runs on server and client. Pages opt in with
// `definePageMeta({ middleware: "auth" })`.
export default defineNuxtRouteMiddleware((to) => {
  const user = useCookie<AuthUser | null>("scs_user")

  if (!user.value) {
    return navigateTo(`/connexion?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
