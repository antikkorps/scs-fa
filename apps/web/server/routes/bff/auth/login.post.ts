import type { AuthUser } from "~/types/admin"

interface ApiLoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: AuthUser
}

// BFF login: proxies to the API and stashes BOTH tokens in httpOnly cookies.
// Only the (non-secret) user is returned for UI state — the access token never
// reaches client JS (it's attached server-side by the /bff/api/* proxy).
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const res = await callAuthApi<ApiLoginResponse>(event, "/auth/login", body)

  setRefreshCookie(event, res.refreshToken)
  setAccessCookie(event, res.accessToken)

  return { user: res.user }
})
