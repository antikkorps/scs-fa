import type { AuthUser } from "~/types/admin"

// Route guard for the admin area. Runs on server and client; reads the auth
// cookies so a deep link or reload is gated before any admin page renders.
export default defineNuxtRouteMiddleware((to) => {
  const token = useCookie<string | null>("scs_admin_token")
  const user = useCookie<AuthUser | null>("scs_admin_user")

  if (!token.value || user.value?.role !== "admin") {
    return navigateTo(`/admin/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
