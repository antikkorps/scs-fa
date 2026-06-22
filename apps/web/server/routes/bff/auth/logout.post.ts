// BFF logout: revokes the refresh token server-side (best effort) and clears the
// httpOnly cookie. Always succeeds from the client's point of view.
export default defineEventHandler(async (event) => {
  const refreshToken = readRefreshCookie(event)
  if (refreshToken) {
    try {
      await callAuthApi(event, "/auth/logout", { refreshToken })
    } catch {
      // Revocation is best-effort; the cookie is cleared regardless.
    }
  }
  clearRefreshCookie(event)
  return sendNoContent(event, 204)
})
