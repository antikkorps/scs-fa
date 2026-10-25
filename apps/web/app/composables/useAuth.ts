import type { RegisterInput } from "@armurier/shared"
import type { AuthUser } from "~/types/admin"

// Unified auth for the whole site (storefront customers + admins). Both session
// tokens live in httpOnly cookies managed exclusively by the BFF — client JS
// never sees them. The browser keeps only a non-secret `scs_user` cookie for UI
// state (display name, role); the server enforces all authorization.
const USER_COOKIE_OPTS = { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: !import.meta.dev } as const

/** Story 12.8e — the authenticator app to enrol at login (an admin without it). */
export interface LoginEnrolment {
  secret: string
  otpauthUri: string
  qrSvg: string
}

export type LoginMethod = "email_code" | "totp" | "totp_enrollment"

export type LoginOutcome =
  | { status: "signed_in"; user: AuthUser }
  | { status: "code_required"; method: LoginMethod; expiresIn: number; enrollment?: LoginEnrolment }

/** The second step's answer: the session's user, and the recovery codes when the app just enrolled. */
export interface CodeOutcome {
  user: AuthUser
  recoveryCodes?: string[]
}

export function useAuth() {
  const user = useCookie<AuthUser | null>("scs_user", USER_COOKIE_OPTS)

  // Story 12.8a: for some accounts the right password is not enough — the BFF
  // keeps the challenge in an httpOnly cookie and the mailed code finishes it.
  // Story 12.8e: or the authenticator app's code, or its enrolment.
  async function login(email: string, password: string): Promise<LoginOutcome> {
    const res = await $fetch<
      { user: AuthUser } | { codeRequired: true; method: LoginMethod; expiresIn: number; enrollment?: LoginEnrolment }
    >("/bff/auth/login", { method: "POST", body: { email, password } })
    if ("codeRequired" in res) {
      return { status: "code_required", method: res.method, expiresIn: res.expiresIn, enrollment: res.enrollment }
    }
    user.value = res.user
    return { status: "signed_in", user: res.user }
  }

  async function verifyLoginCode(code: string): Promise<CodeOutcome> {
    const res = await $fetch<CodeOutcome>("/bff/auth/login/verify", { method: "POST", body: { code } })
    user.value = res.user
    return res
  }

  async function resendLoginCode(): Promise<void> {
    await $fetch("/bff/auth/login/resend", { method: "POST" })
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
    verifyLoginCode,
    resendLoginCode,
    register,
    logout,
    refresh,
    forgotPassword,
    resetPassword,
    isAuthenticated,
    isAdmin,
  }
}
