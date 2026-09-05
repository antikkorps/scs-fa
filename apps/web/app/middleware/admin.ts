import type { AuthUser } from "~/types/admin"

// Route guard for the admin area. Runs on server and client. The session tokens
// are httpOnly (invisible to client JS), so this UX gate reads the non-secret
// `scs_user` cookie; the API still enforces the real admin role on every call,
// so a forged cookie gets no data.
export default defineNuxtRouteMiddleware((to) => {
  const user = useCookie<AuthUser | null>("scs_user")

  if (user.value?.role !== "admin") {
    return navigateTo(`/admin/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
