// BFF refresh: rotates the httpOnly session cookies against the API. The new
// access token stays server-side (httpOnly) — the client only learns whether
// the session is still alive. No/invalid refresh cookie → 401.
export default defineEventHandler(async (event) => {
  const token = await refreshSession(event)
  if (!token) {
    throw createError({ statusCode: 401, data: { error: "NoSession" }, message: "No session" })
  }
  return { ok: true }
})
