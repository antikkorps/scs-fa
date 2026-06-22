interface ApiRefreshResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

// BFF refresh: reads the httpOnly refresh cookie, rotates it against the API,
// and hands back a fresh access token. No refresh cookie → no session.
export default defineEventHandler(async (event) => {
  const refreshToken = readRefreshCookie(event)
  if (!refreshToken) {
    throw createError({ statusCode: 401, data: { error: "NoSession" }, message: "No session" })
  }

  let res: ApiRefreshResponse
  try {
    res = await callAuthApi<ApiRefreshResponse>(event, "/auth/refresh", { refreshToken })
  } catch (err) {
    // The token is invalid/expired/rotated away — drop the stale cookie.
    clearRefreshCookie(event)
    throw err
  }

  setRefreshCookie(event, res.refreshToken)

  return { accessToken: res.accessToken, expiresIn: res.expiresIn }
})
