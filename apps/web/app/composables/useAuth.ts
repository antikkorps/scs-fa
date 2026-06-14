import type { AuthUser } from "~/types/admin"

// Auth state lives in two cookies so it survives a full reload and is readable
// during SSR (the middleware runs on the server too): a bearer token and a
// non-sensitive copy of the signed-in user (email / name / role).
const COOKIE_OPTS = { sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 } as const

export function useAuth() {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase as string

  const token = useCookie<string | null>("scs_admin_token", COOKIE_OPTS)
  const user = useCookie<AuthUser | null>("scs_admin_user", COOKIE_OPTS)

  async function login(email: string, password: string): Promise<AuthUser> {
    const res = await $fetch<{ accessToken: string; user: AuthUser }>(`${apiBase}/auth/login`, {
      method: "POST",
      body: { email, password },
    })
    token.value = res.accessToken
    user.value = res.user
    return res.user
  }

  function logout() {
    token.value = null
    user.value = null
  }

  const isAuthenticated = computed(() => Boolean(token.value))
  const isAdmin = computed(() => user.value?.role === "admin")

  return { token, user, login, logout, isAuthenticated, isAdmin }
}
