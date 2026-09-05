import type { RegisterInput } from "@armurier/shared"
import type { AuthUser } from "~/types/admin"

// Unified auth for the whole site (storefront customers + admins). Both session
// tokens live in httpOnly cookies managed exclusively by the BFF — client JS
// never sees them. The browser keeps only a non-secret `scs_user` cookie for UI
// state (display name, role); the server enforces all authorization.
const USER_COOKIE_OPTS = { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: !import.meta.dev } as const

export function useAuth() {
  const user = useCookie<AuthUser | null>("scs_user", USER_COOKIE_OPTS)

  async function login(email: string, password: string): Promise<AuthUser> {
    const res = await $fetch<{ user: AuthUser }>("/bff/auth/login", { method: "POST", body: { email, password } })
    user.value = res.user
    return res.user
  }

  async function register(input: RegisterInput): Promise<AuthUser> {
    const res = await $fetch<{ user: AuthUser }>("/bff/auth/register", { method: "POST", body: input })
    user.value = res.user
    return res.user
  }

  async function logout(): Promise<void> {
    try {
      await $fetch("/bff/auth/logout", { method: "POST" })
    } finally {
      user.value = null
    }
  }

  // Rotates the httpOnly session cookies server-side (the tokens stay out of JS).
  // Returns whether the session is still alive; clears the user copy when it's not.
  async function refresh(): Promise<boolean> {
    try {
      await $fetch("/bff/auth/refresh", { method: "POST" })
      return true
    } catch {
      user.value = null
      return false
    }
  }

  function forgotPassword(email: string) {
    return $fetch("/bff/auth/forgot-password", { method: "POST", body: { email } })
  }

  function resetPassword(resetToken: string, password: string) {
    return $fetch("/bff/auth/reset-password", { method: "POST", body: { token: resetToken, password } })
  }

  const isAuthenticated = computed(() => Boolean(user.value))
  const isAdmin = computed(() => user.value?.role === "admin")

  return {
    user,
    login,
    register,
    logout,
    refresh,
    forgotPassword,
    resetPassword,
    isAuthenticated,
    isAdmin,
  }
}
