import type { AuthUser } from "~/types/admin"

interface ApiLoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: AuthUser
}

// BFF login: proxies to the API, stashes the refresh token in an httpOnly
// cookie, and returns only the access token + user to the browser.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const res = await callAuthApi<ApiLoginResponse>(event, "/auth/login", body)

  setRefreshCookie(event, res.refreshToken)

  return { accessToken: res.accessToken, expiresIn: res.expiresIn, user: res.user }
})
