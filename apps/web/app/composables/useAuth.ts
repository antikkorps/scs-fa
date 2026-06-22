import type { RegisterInput } from "@armurier/shared"
import type { AuthUser } from "~/types/admin"

// Unified auth for the whole site (storefront customers + admins). The session
// lives in two non-httpOnly cookies so it survives reloads and is readable
// during SSR: the access token (bearer, attached by useApi) and a copy of the
// signed-in user. The refresh token is httpOnly and handled exclusively by the
// BFF routes under /bff/auth/* — it never touches client JS.
const COOKIE_OPTS = { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 } as const

interface SessionResponse {
  accessToken: string
  expiresIn: number
  user: AuthUser
}

export function useAuth() {
  const token = useCookie<string | null>("scs_token", COOKIE_OPTS)
  const user = useCookie<AuthUser | null>("scs_user", COOKIE_OPTS)

  async function login(email: string, password: string): Promise<AuthUser> {
    const res = await $fetch<SessionResponse>("/bff/auth/login", {
      method: "POST",
      body: { email, password },
    })
    token.value = res.accessToken
    user.value = res.user
    return res.user
  }

  async function register(input: RegisterInput): Promise<AuthUser> {
    const res = await $fetch<SessionResponse>("/bff/auth/register", {
      method: "POST",
      body: input,
    })
    token.value = res.accessToken
    user.value = res.user
    return res.user
  }

  async function logout(): Promise<void> {
    try {
      await $fetch("/bff/auth/logout", { method: "POST" })
    } finally {
      token.value = null
      user.value = null
    }
  }

  // Exchanges the httpOnly refresh cookie for a fresh access token. Returns the
  // new token, or null if the session is gone (caller should redirect to login).
  async function refresh(): Promise<string | null> {
    try {
      const res = await $fetch<{ accessToken: string; expiresIn: number }>("/bff/auth/refresh", {
        method: "POST",
      })
      token.value = res.accessToken
      return res.accessToken
    } catch {
      token.value = null
      user.value = null
      return null
    }
  }

  function forgotPassword(email: string) {
    return $fetch("/bff/auth/forgot-password", { method: "POST", body: { email } })
  }

  function resetPassword(resetToken: string, password: string) {
    return $fetch("/bff/auth/reset-password", { method: "POST", body: { token: resetToken, password } })
  }

  const isAuthenticated = computed(() => Boolean(token.value))
  const isAdmin = computed(() => user.value?.role === "admin")

  return {
    token,
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
